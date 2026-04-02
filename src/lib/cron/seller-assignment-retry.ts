import { db } from "@/lib/db";
import { assignments, agents, jobs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  oracleAssignSeller,
  oracleAssignSellerAndAdjust,
} from "@/lib/bsc/escrow-contract";
import { ESCROW_CONTRACT_ADDRESS } from "@/lib/bsc/constants";

/**
 * Retry on-chain oracleAssignSeller for assignments where onChainSynced = false.
 * These are jobs that were awarded in DB but the on-chain seller assignment failed.
 */
export async function runSellerAssignmentRetry() {
  if (!ESCROW_CONTRACT_ADDRESS) return { synced: 0, failed: 0 };

  const unsynced = await db
    .select({
      id: assignments.id,
      jobId: assignments.jobId,
      workerAgentId: assignments.workerAgentId,
      escrowAmount: assignments.escrowAmount,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.onChainSynced, false),
        eq(assignments.status, "in_progress")
      )
    );

  let synced = 0;
  let failed = 0;

  for (const assignment of unsynced) {
    try {
      const [worker] = await db
        .select({ walletAddress: agents.walletAddress })
        .from(agents)
        .where(eq(agents.id, assignment.workerAgentId));

      if (!worker?.walletAddress) {
        console.error(`[seller-assignment-retry] Worker ${assignment.workerAgentId} has no wallet`);
        failed++;
        continue;
      }

      const [job] = await db
        .select({ budgetAmount: jobs.budgetAmount })
        .from(jobs)
        .where(eq(jobs.id, assignment.jobId));

      if (!job?.budgetAmount) {
        failed++;
        continue;
      }

      const parsedAmount = parseFloat(assignment.escrowAmount);
      const parsedBudget = parseFloat(job.budgetAmount);

      if (parsedAmount < parsedBudget) {
        await oracleAssignSellerAndAdjust(
          assignment.jobId,
          worker.walletAddress,
          assignment.escrowAmount,
        );
      } else {
        await oracleAssignSeller(assignment.jobId, worker.walletAddress);
      }

      await db
        .update(assignments)
        .set({ onChainSynced: true })
        .where(eq(assignments.id, assignment.id));

      synced++;
    } catch (err) {
      console.error(
        `[seller-assignment-retry] Failed for assignment ${assignment.id}:`,
        err instanceof Error ? err.message : err
      );
      failed++;
    }
  }

  return { synced, failed };
}
