import { db, withTransaction, type TX } from "@/lib/db";
import { jobs, assignments, escrows, agents } from "@/lib/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { emitFeedEvent } from "@/lib/services/feed";
import { validateJobTransition, validateEscrowTransition } from "@/lib/services/state-machine";
import { oracleRefund } from "@/lib/bsc/escrow-contract";
import { transferUSDC } from "@/lib/bsc/usdc";

export async function runJobExpiry() {
  const now = new Date();

  const expiredJobs = await db
    .select()
    .from(jobs)
    .where(
      and(eq(jobs.status, "open"), lte(jobs.expiresAt, now))
    );

  let processed = 0;

  for (const job of expiredJobs) {
    try {
      await withTransaction(async (tx: TX) => {
        // Refund the job escrow (funds at platform wallet)
        const [jobEscrow] = await tx
          .select()
          .from(escrows)
          .where(
            and(eq(escrows.jobId, job.id), eq(escrows.status, "funded"))
          );

        if (jobEscrow) {
          validateEscrowTransition(jobEscrow.status, "refunded", jobEscrow.id);

          if (jobEscrow.onChainTxHash) {
            // On-chain escrow exists — refund via contract
            const refundTxHash = await oracleRefund(jobEscrow.id);
            await tx
              .update(escrows)
              .set({ status: "refunded", refundedAt: now, releaseTxHash: refundTxHash })
              .where(eq(escrows.id, jobEscrow.id));
          } else {
            // Pre-award: USDC at platform wallet — transfer back to creator
            const [creator] = await tx
              .select({ walletAddress: agents.walletAddress })
              .from(agents)
              .where(eq(agents.id, job.creatorAgentId));

            if (creator?.walletAddress) {
              await transferUSDC(creator.walletAddress, jobEscrow.amount);
            }
            await tx
              .update(escrows)
              .set({ status: "refunded", refundedAt: now })
              .where(eq(escrows.id, jobEscrow.id));
          }
        }

        // Cancel active assignments
        await tx
          .update(assignments)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(assignments.jobId, job.id),
              eq(assignments.status, "in_progress")
            )
          );

        // Mark job expired
        validateJobTransition(job.status, "expired", job.id);
        await tx
          .update(jobs)
          .set({ status: "expired", updatedAt: now })
          .where(eq(jobs.id, job.id));
      });

      await emitFeedEvent("job_expired", job.id, {
        job_id: job.id,
        title: job.title,
      });

      processed++;
    } catch {
      // Log but continue processing other jobs
    }
  }

  return { processed };
}
