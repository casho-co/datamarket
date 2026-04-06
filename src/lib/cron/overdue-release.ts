/**
 * Cancels assignments where the worker missed their deadline and refunds the creator.
 *
 * Example: Bob gets awarded a job with a 3-day deadline. He never submits work.
 * After 3 days, this cron cancels the assignment, refunds escrow to the creator,
 * increments Bob's abandonedJobs count, and writes negative on-chain reputation.
 *
 * Without this: Creator's money stays locked. Worker faces no penalty for ghosting.
 */
import { db } from "@/lib/db";
import { assignments, escrows, reputation, agents } from "@/lib/db/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { emitFeedEvent } from "@/lib/services/feed";
import { validateEscrowTransition } from "@/lib/services/state-machine";
import { oracleRefund } from "@/lib/bsc/escrow-contract";
import { giveOnChainFeedback } from "@/lib/bsc/erc8004";

export async function runOverdueRelease() {
  const now = new Date();

  const overdueAssignments = await db
    .select({
      id: assignments.id,
      jobId: assignments.jobId,
      workerAgentId: assignments.workerAgentId,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.status, "in_progress"),
        lte(assignments.deadlineAt, now)
      )
    )
    .orderBy(assignments.deadlineAt)
    .limit(3);

  let processed = 0;

  for (const assignment of overdueAssignments) {
    try {
      // Find escrow for this assignment
      const [escrow] = await db
        .select({ id: escrows.id, status: escrows.status, onChainTxHash: escrows.onChainTxHash })
        .from(escrows)
        .where(
          and(
            eq(escrows.assignmentId, assignment.id),
            eq(escrows.status, "funded")
          )
        );

      // On-chain refund BEFORE DB updates
      let refundTxHash: string | null = null;
      if (escrow?.onChainTxHash) {
        validateEscrowTransition(escrow.status, "refunded", escrow.id);
        refundTxHash = await oracleRefund(escrow.id);
      }

      // DB updates (no RPC calls, fast)
      await db
        .update(assignments)
        .set({ status: "cancelled" })
        .where(eq(assignments.id, assignment.id));

      await db
        .update(reputation)
        .set({
          abandonedJobs: sql`${reputation.abandonedJobs} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(reputation.agentId, assignment.workerAgentId));

      if (escrow && refundTxHash) {
        await db
          .update(escrows)
          .set({ status: "refunded", refundedAt: now, releaseTxHash: refundTxHash })
          .where(eq(escrows.id, escrow.id));
      }

      // Post-update side effects (best-effort)
      await emitFeedEvent("assignment_overdue", assignment.jobId, {
        job_id: assignment.jobId,
        assignment_id: assignment.id,
        worker_agent_id: assignment.workerAgentId,
      });

      try {
        const [worker] = await db
          .select({ erc8004AgentId: agents.erc8004AgentId })
          .from(agents)
          .where(eq(agents.id, assignment.workerAgentId));

        if (worker?.erc8004AgentId) {
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://datalayer-market.fly.dev";
          await giveOnChainFeedback({
            agentId: worker.erc8004AgentId,
            value: -50,
            tag1: "job",
            tag2: "abandoned",
            feedbackURI: `${baseUrl}/api/v1/jobs/${assignment.jobId}`,
          });
        }
      } catch {
        // On-chain feedback is best-effort
      }

      processed++;
    } catch (err) {
      console.error(`[overdue-release] Failed for assignment ${assignment.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { processed };
}
