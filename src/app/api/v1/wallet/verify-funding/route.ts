import { NextRequest, NextResponse } from "next/server";
import { requireScope, requireOnChainIdentity } from "@/lib/auth/middleware";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { getNonce, validateNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { withTransaction } from "@/lib/db";
import { jobs, escrows, reputation } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getOnChainEscrow, parseTokenAmount, OnChainEscrowState } from "@/lib/bsc/escrow-contract";
import { ESCROW_REF } from "@/lib/config";
import { getPublicClient } from "@/lib/bsc/client";
import { ESCROW_CONTRACT_ADDRESS } from "@/lib/bsc/constants";
import { emitFeedEvent } from "@/lib/services/feed";
import { type Hex } from "viem";
import { z } from "zod";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const verifyFundingBodySchema = z.object({
  tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  job_id: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const auth = await requireScope(req, "financial");
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl } = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  const gate = requireOnChainIdentity(auth);
  if (gate) return gate;

  const nonce = getNonce(req);
  if (nonce) {
    const nonceResult = await validateNonce(auth.agentId, nonce);
    if (nonceResult) return nonceResult;
  }

  let body: z.infer<typeof verifyFundingBodySchema>;
  try {
    const raw = await req.json();
    const parsed = verifyFundingBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { tx_hash, job_id } = body;
  const walletAddress = auth.walletAddress;

  if (!walletAddress) {
    return NextResponse.json({ error: "Agent has no wallet address" }, { status: 400 });
  }

  try {
    // ── On-chain reads BEFORE the transaction (no DB lock held) ──

    const publicClient = getPublicClient();
    let receipt;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: tx_hash as Hex });
    } catch {
      return NextResponse.json({ error: "Transaction not found on-chain" }, { status: 400 });
    }

    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Transaction failed on-chain" }, { status: 400 });
    }
    if (!receipt.to || receipt.to.toLowerCase() !== ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
      return NextResponse.json({ error: "Transaction does not target the escrow contract" }, { status: 400 });
    }
    if (receipt.from.toLowerCase() !== walletAddress.toLowerCase()) {
      return NextResponse.json({ error: "Transaction sender does not match your wallet" }, { status: 403 });
    }

    const onChainEscrow = await getOnChainEscrow(job_id);

    if (onChainEscrow.state !== OnChainEscrowState.FUNDED) {
      return NextResponse.json({ error: "On-chain escrow not in FUNDED state" }, { status: 400 });
    }
    if (onChainEscrow.buyer.toLowerCase() !== walletAddress.toLowerCase()) {
      return NextResponse.json({ error: "On-chain buyer does not match your wallet" }, { status: 403 });
    }
    if (onChainEscrow.seller.toLowerCase() !== ZERO_ADDRESS) {
      return NextResponse.json({ error: "On-chain escrow already has a seller assigned" }, { status: 400 });
    }

    // ── Short DB transaction — only DB reads/writes, no RPC calls ──

    const result = await withTransaction(async (tx) => {
      // 1. Lock the job row — prevents concurrent verify-funding calls
      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, job_id))
        .for("update");

      if (!job) {
        return { error: "Job not found", httpStatus: 404 } as const;
      }

      // 2. Idempotent: already verified → return success
      if (job.verified) {
        return { job_id, status: "verified", message: "Job already verified" } as const;
      }

      // 3. Job must be open
      if (job.status !== "open") {
        return { error: "Job is not open", httpStatus: 409 } as const;
      }

      // 4. Verify the caller is the job creator
      if (job.creatorAgentId !== auth.agentId) {
        return { error: "Not job creator", httpStatus: 403 } as const;
      }

      // 5. Dedup: ensure no escrow already exists with this tx hash
      const [existingEscrow] = await tx
        .select({ id: escrows.id })
        .from(escrows)
        .where(eq(escrows.onChainTxHash, tx_hash));
      if (existingEscrow) {
        return { error: "Transaction already used for another escrow", httpStatus: 409 } as const;
      }

      // 6. Verify amount matches budget (exact match in wei)
      if (!job.budgetAmount) {
        return { error: "Job has no budget set", httpStatus: 400 } as const;
      }
      const expectedWei = parseTokenAmount(job.budgetAmount, "USDC");
      if (onChainEscrow.amount !== expectedWei) {
        return { error: "On-chain amount does not match job budget", httpStatus: 400 } as const;
      }

      // 7. All checks pass — create escrow DB row
      await tx.insert(escrows).values({
        refId: job_id,
        refType: ESCROW_REF.JOB,
        funderAgentId: auth.agentId,
        recipientAgentId: null,
        amount: job.budgetAmount,
        status: "funded",
        onChainTxHash: tx_hash,
      });

      // 8. Set verified=true
      await tx
        .update(jobs)
        .set({ verified: true, updatedAt: new Date() })
        .where(eq(jobs.id, job_id));

      // 9. Update reputation stats
      await tx
        .update(reputation)
        .set({
          jobsPosted: sql`${reputation.jobsPosted} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(reputation.agentId, auth.agentId));

      // 10. Audit log (after ownership verified)
      await logAudit({
        agentId: auth.agentId,
        action: "verify_funding",
        resourceType: "job",
        resourceId: job_id,
        metadata: { txHash: tx_hash },
        ipAddress: getClientIp(req),
      });

      return {
        job_id,
        status: "verified" as const,
        message: "Job is now live",
        _emitFeed: true,
        _jobTitle: job.title,
        _budgetAmount: job.budgetAmount,
        _jobType: job.jobType,
      };
    });

    // Handle error responses from within the transaction
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.httpStatus }
      );
    }

    // Emit feed event outside the transaction (non-critical)
    if ("_emitFeed" in result && result._emitFeed) {
      await emitFeedEvent("job_funded", job_id, {
        job_id,
        title: result._jobTitle,
        creator_agent_id: auth.agentId,
        budget_amount: result._budgetAmount,
        job_type: result._jobType,
      });
    }

    return NextResponse.json({
      job_id: result.job_id,
      status: result.status,
      message: result.message,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed" },
      { status: 500 }
    );
  }
}
