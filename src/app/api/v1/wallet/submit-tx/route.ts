import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { getNonce, validateNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { db } from "@/lib/db";
import { jobs, escrows, agents, reputation } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getOnChainEscrow, uuidToBytes32, parseTokenAmount } from "@/lib/bsc/escrow-contract";
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
    // Idempotent: atomically set verified=true only if currently false
    const [updatedJob] = await db
      .update(jobs)
      .set({ verified: true, updatedAt: new Date() })
      .where(and(eq(jobs.id, job_id), eq(jobs.verified, false)))
      .returning();

    if (!updatedJob) {
      // Already verified — check if this is a safe idempotent retry
      const [existingJob] = await db.select().from(jobs).where(eq(jobs.id, job_id));
      if (!existingJob) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
      if (existingJob.verified) {
        return NextResponse.json({
          job_id,
          status: "verified",
          message: "Job already verified",
        });
      }
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Verify the caller is the job creator
    if (updatedJob.creatorAgentId !== auth.agentId) {
      // Rollback: revert verified flag
      await db.update(jobs).set({ verified: false }).where(eq(jobs.id, job_id));
      return NextResponse.json({ error: "Not job creator" }, { status: 403 });
    }

    // Dedup: ensure no escrow already exists with this tx hash
    const [existingEscrow] = await db
      .select({ id: escrows.id })
      .from(escrows)
      .where(eq(escrows.onChainTxHash, tx_hash));
    if (existingEscrow) {
      return NextResponse.json({ error: "Transaction already used for another escrow" }, { status: 409 });
    }

    // Read on-chain escrow state to verify
    const refIdBytes32 = uuidToBytes32(job_id);
    const onChainEscrow = await getOnChainEscrow(job_id);

    // Verify on-chain state
    // State 1 = FUNDED
    if (onChainEscrow.state !== 1) {
      await db.update(jobs).set({ verified: false }).where(eq(jobs.id, job_id));
      return NextResponse.json({ error: "On-chain escrow not in FUNDED state" }, { status: 400 });
    }

    // Verify buyer matches agent's wallet
    const [agent] = await db
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, auth.agentId));

    if (!agent?.walletAddress || onChainEscrow.buyer.toLowerCase() !== agent.walletAddress.toLowerCase()) {
      await db.update(jobs).set({ verified: false }).where(eq(jobs.id, job_id));
      return NextResponse.json({ error: "On-chain buyer does not match your wallet" }, { status: 403 });
    }

    // Verify amount matches budget (exact match in wei)
    if (!updatedJob.budgetAmount) {
      await db.update(jobs).set({ verified: false }).where(eq(jobs.id, job_id));
      return NextResponse.json({ error: "Job has no budget set" }, { status: 400 });
    }
    const expectedWei = parseTokenAmount(updatedJob.budgetAmount, "USDC");
    if (onChainEscrow.amount !== expectedWei) {
      await db.update(jobs).set({ verified: false }).where(eq(jobs.id, job_id));
      return NextResponse.json({ error: "On-chain amount does not match job budget" }, { status: 400 });
    }

    // Verify seller is address(0) — not yet assigned
    if (onChainEscrow.seller.toLowerCase() !== ZERO_ADDRESS) {
      await db.update(jobs).set({ verified: false }).where(eq(jobs.id, job_id));
      return NextResponse.json({ error: "On-chain escrow already has a seller assigned" }, { status: 400 });
    }

    // All checks pass — create escrow DB row
    await db.insert(escrows).values({
      refId: job_id,
      refType: "job",
      funderAgentId: auth.agentId,
      recipientAgentId: null,
      amount: updatedJob.budgetAmount,
      status: "funded",
      onChainTxHash: tx_hash,
    });

    // Update reputation stats (deferred from createJob)
    await db
      .update(reputation)
      .set({
        jobsPosted: sql`${reputation.jobsPosted} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(reputation.agentId, auth.agentId));

    // Emit deferred feed event
    await emitFeedEvent("job_created", job_id, {
      job_id,
      title: updatedJob.title,
      creator_agent_id: auth.agentId,
      budget_amount: updatedJob.budgetAmount,
      job_type: updatedJob.jobType,
    });

    return NextResponse.json({
      job_id,
      status: "verified",
      message: "Job is now live",
    });
  } catch (err) {
    // On failure, revert verified flag
    await db.update(jobs).set({ verified: false }).where(eq(jobs.id, job_id)).catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed" },
      { status: 500 }
    );
  }
}
