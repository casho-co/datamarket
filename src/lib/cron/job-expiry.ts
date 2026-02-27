import { db, withTransaction, type TX } from "@/lib/db";
import { jobs, assignments, escrows } from "@/lib/db/schema";
import { eq, and, lte, inArray } from "drizzle-orm";
import { emitFeedEvent } from "@/lib/services/feed";
import { validateJobTransition, validateEscrowTransition } from "@/lib/services/state-machine";
import { oracleRefund } from "@/lib/bsc/escrow-contract";

export async function runJobExpiry() {
  const now = new Date();

  const expiredJobs = await db
    .select()
    .from(jobs)
    .where(
      and(inArray(jobs.status, ["open", "filling"]), lte(jobs.expiresAt, now))
    );

  let processed = 0;

  for (const job of expiredJobs) {
    try {
      await withTransaction(async (tx: TX) => {
        // Refund any funded escrows
        const jobEscrows = await tx
          .select({
            id: escrows.id,
            status: escrows.status,
            onChainTxHash: escrows.onChainTxHash,
          })
          .from(escrows)
          .innerJoin(assignments, eq(escrows.assignmentId, assignments.id))
          .where(
            and(eq(assignments.jobId, job.id), eq(escrows.status, "funded"))
          );

        for (const esc of jobEscrows) {
          if (!esc.onChainTxHash) continue; // Skip escrows not yet funded on-chain
          validateEscrowTransition(esc.status, "refunded", esc.id);
          const refundTxHash = await oracleRefund(esc.id);
          await tx
            .update(escrows)
            .set({ status: "refunded", refundedAt: now, releaseTxHash: refundTxHash })
            .where(eq(escrows.id, esc.id));
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
