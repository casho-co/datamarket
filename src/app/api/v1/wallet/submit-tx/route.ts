import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { getNonce, validateNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { withTransaction } from "@/lib/db";
import { jobs, escrows, agents, reputation } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getOnChainEscrow, parseTokenAmount } from "@/lib/bsc/escrow-contract";
import { emitFeedEvent } from "@/lib/services/feed";
import { z } from "zod";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const submitTxBodySchema = z.object({
  tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  job_id: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const auth = await requireScope(req, "financial");
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl } = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  const nonce = getNonce(req);
  if (nonce) {
    const nonceResult = await validateNonce(auth.agentId, nonce);
    if (nonceResult) return nonceResult;
  }

  let body: z.infer<typeof submitTxBodySchema>;
  try {
    const raw = await req.json();
    const parsed = submitTxBodySchema.safeParse(raw);
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

  await logAudit({
    agentId: auth.agentId,
    action: "submit_tx",
    resourceType: "wallet",
    resourceId: auth.agentId,
    metadata: { txHash: tx_hash, jobId: job_id },
    ipAddress: getClientIp(req),
  });

  try {
    const result = await withTransaction(async (tx) => {
      // 1. Lock the job row — prevents concurrent submit-tx calls
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

      // 3. Verify the caller is the job creator
      if (job.creatorAgentId !== auth.agentId) {
        return { error: "Not job creator", httpStatus: 403 } as const;
      }

      // 4. Dedup: ensure no escrow already exists with this tx hash
      const [existingEscrow] = await tx
        .select({ id: escrows.id })
        .from(escrows)
        .where(eq(escrows.onChainTxHash, tx_hash));
      if (existingEscrow) {
        return { error: "Transaction already used for another escrow", httpStatus: 409 } as const;
      }

      // 5. Fetch agent wallet address
      const [agent] = await tx
        .select({ walletAddress: agents.walletAddress })
        .from(agents)
        .where(eq(agents.id, auth.agentId));

      if (!agent?.walletAddress) {
        return { error: "Agent has no wallet address", httpStatus: 400 } as const;
      }

      // 6. Read on-chain escrow state to verify
      const onChainEscrow = await getOnChainEscrow(job_id);

      // State 1 = FUNDED
      if (onChainEscrow.state !== 1) {
        return { error: "On-chain escrow not in FUNDED state", httpStatus: 400 } as const;
      }

      // Verify buyer matches agent's wallet
      if (onChainEscrow.buyer.toLowerCase() !== agent.walletAddress.toLowerCase()) {
        return { error: "On-chain buyer does not match your wallet", httpStatus: 403 } as const;
      }

      // Verify amount matches budget (exact match in wei)
      if (!job.budgetAmount) {
        return { error: "Job has no budget set", httpStatus: 400 } as const;
      }
      const expectedWei = parseTokenAmount(job.budgetAmount, "USDC");
      if (onChainEscrow.amount !== expectedWei) {
        return { error: "On-chain amount does not match job budget", httpStatus: 400 } as const;
      }

      // Verify seller is address(0) — not yet assigned
      if (onChainEscrow.seller.toLowerCase() !== ZERO_ADDRESS) {
        return { error: "On-chain escrow already has a seller assigned", httpStatus: 400 } as const;
      }

      // 7. All checks pass — create escrow DB row
      await tx.insert(escrows).values({
        refId: job_id,
        refType: "job",
        funderAgentId: auth.agentId,
        recipientAgentId: null,
        amount: job.budgetAmount,
        status: "funded",
        onChainTxHash: tx_hash,
      });

      // 8. NOW set verified=true — only after all checks pass
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
      await emitFeedEvent("job_created", job_id, {
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
