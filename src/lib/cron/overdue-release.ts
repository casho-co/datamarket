import { db, withTransaction, type TX } from "@/lib/db";
import { assignments, escrows } from "@/lib/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { emitFeedEvent } from "@/lib/services/feed";
import { validateEscrowTransition } from "@/lib/services/state-machine";
import { oracleRefund } from "@/lib/bsc/escrow-contract";

export async function runOverdueRelease() {
  const now = new Date();

  const overdueAssignments = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.status, "in_progress"),
        lte(assignments.deadlineAt, now)
      )
    );

  let processed = 0;

  for (const assignment of overdueAssignments) {
    try {
      await withTransaction(async (tx: TX) => {
        // Cancel assignment
        await tx
          .update(assignments)
          .set({ status: "cancelled" })
          .where(eq(assignments.id, assignment.id));

        // Refund escrow
        const [escrow] = await tx
          .select()
          .from(escrows)
          .where(
            and(
              eq(escrows.assignmentId, assignment.id),
              eq(escrows.status, "funded")
            )
          );

        if (escrow && escrow.onChainTxHash) {
          validateEscrowTransition(escrow.status, "refunded", escrow.id);
          const refundTxHash = await oracleRefund(escrow.id);
          await tx
            .update(escrows)
            .set({ status: "refunded", refundedAt: now, releaseTxHash: refundTxHash })
            .where(eq(escrows.id, escrow.id));
        }
      });

      await emitFeedEvent("assignment_overdue", assignment.jobId, {
        job_id: assignment.jobId,
        assignment_id: assignment.id,
        worker_agent_id: assignment.workerAgentId,
      });

      processed++;
    } catch {
      // Continue processing other assignments
    }
  }

  return { processed };
}
