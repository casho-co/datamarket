import { db, withTransaction, type TX } from "@/lib/db";
import { assignments, jobs, disputes } from "@/lib/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { emitFeedEvent } from "@/lib/services/feed";
import { validateAssignmentTransition } from "@/lib/services/state-machine";

const AUTO_DISPUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function runAutoDispute() {
  const cutoff = new Date(Date.now() - AUTO_DISPUTE_TIMEOUT_MS);

  const staleAssignments = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.status, "submitted"),
        lte(assignments.submittedAt, cutoff)
      )
    );

  let processed = 0;

  for (const assignment of staleAssignments) {
    try {
      // Check no dispute exists already
      const existingDisputes = await db
        .select()
        .from(disputes)
        .where(eq(disputes.assignmentId, assignment.id));

      if (existingDisputes.length > 0) continue;

      const [job] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, assignment.jobId));
      if (!job) continue;

      await withTransaction(async (tx: TX) => {
        // Auto-create dispute to protect worker (no deposit required)
        await tx.insert(disputes).values({
          assignmentId: assignment.id,
          openerAgentId: assignment.workerAgentId,
          resolverAgentId: job.disputeAgentId || null,
          reason: "Auto-dispute: requester did not review within 24 hours",
          depositAmount: "0",
        });

        validateAssignmentTransition(assignment.status, "disputed", assignment.id);
        await tx
          .update(assignments)
          .set({ status: "disputed" })
          .where(eq(assignments.id, assignment.id));
      });

      await emitFeedEvent("auto_dispute", job.id, {
        job_id: job.id,
        assignment_id: assignment.id,
        reason: "Review timeout",
      });

      processed++;
    } catch (err) {
      console.error(`[auto-dispute] Failed for assignment ${assignment.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { processed };
}
