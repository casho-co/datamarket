import { db } from "@/lib/db";
import { jobs, assignments, escrows } from "@/lib/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { emitFeedEvent } from "@/lib/services/feed";
import { validateJobTransition, validateEscrowTransition } from "@/lib/services/state-machine";
import { oracleRefund } from "@/lib/bsc/escrow-contract";

export async function runJobExpiry() {
  const now = new Date();

  // Only expire verified, open jobs (unverified have no money, no expiry needed)
  const expiredJobs = await db
    .select({ id: jobs.id, status: jobs.status, title: jobs.title })
    .from(jobs)
    .where(
      and(eq(jobs.status, "open"), eq(jobs.verified, true), lte(jobs.expiresAt, now))
    );

  let processed = 0;

  for (const job of expiredJobs) {
    try {
      // Find and refund escrow on-chain BEFORE DB updates
      const [jobEscrow] = await db
        .select({ id: escrows.id, status: escrows.status, onChainTxHash: escrows.onChainTxHash })
        .from(escrows)
        .where(
          and(eq(escrows.refId, job.id), eq(escrows.refType, "job"), eq(escrows.status, "funded"))
        );

      if (jobEscrow?.onChainTxHash) {
        validateEscrowTransition(jobEscrow.status, "refunded", jobEscrow.id);
        const refundTxHash = await oracleRefund(jobEscrow.id);
        await db
          .update(escrows)
          .set({ status: "refunded", refundedAt: now, releaseTxHash: refundTxHash })
          .where(eq(escrows.id, jobEscrow.id));
      }

      // DB updates after on-chain success
      await db
        .update(assignments)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(assignments.jobId, job.id),
            eq(assignments.status, "in_progress")
          )
        );

      validateJobTransition(job.status, "expired", job.id);
      await db
        .update(jobs)
        .set({ status: "expired", updatedAt: now })
        .where(eq(jobs.id, job.id));

      await emitFeedEvent("job_expired", job.id, {
        job_id: job.id,
        title: job.title,
      });

      processed++;
    } catch (err) {
      console.error(`[job-expiry] Failed for job ${job.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { processed };
}
