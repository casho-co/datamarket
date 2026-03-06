import { db, withTransaction, type TX } from "@/lib/db";
import { jobs, assignments, escrows } from "@/lib/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { emitFeedEvent } from "@/lib/services/feed";
import { validateJobTransition, validateEscrowTransition } from "@/lib/services/state-machine";
import { oracleRefund } from "@/lib/bsc/escrow-contract";

export async function runJobExpiry() {
  const now = new Date();

  // Only expire verified, open jobs (unverified have no money, no expiry needed)
  const expiredJobs = await db
    .select()
    .from(jobs)
    .where(
      and(eq(jobs.status, "open"), eq(jobs.verified, true), lte(jobs.expiresAt, now))
    );

  let processed = 0;

  for (const job of expiredJobs) {
    try {
      await withTransaction(async (tx: TX) => {
        // Refund the on-chain escrow
        const [jobEscrow] = await tx
          .select()
          .from(escrows)
          .where(
            and(eq(escrows.refId, job.id), eq(escrows.refType, "job"), eq(escrows.status, "funded"))
          );

        if (jobEscrow && jobEscrow.onChainTxHash) {
          validateEscrowTransition(jobEscrow.status, "refunded", jobEscrow.id);
          const refundTxHash = await oracleRefund(jobEscrow.id);
          await tx
            .update(escrows)
            .set({ status: "refunded", refundedAt: now, releaseTxHash: refundTxHash })
            .where(eq(escrows.id, jobEscrow.id));
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
