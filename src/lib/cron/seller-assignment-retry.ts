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

  // Single JOIN query instead of N+1 per assignment
  const unsynced = await db
    .select({
      id: assignments.id,
      jobId: assignments.jobId,
      workerAgentId: assignments.workerAgentId,
      escrowAmount: assignments.escrowAmount,
      walletAddress: agents.walletAddress,
      budgetAmount: jobs.budgetAmount,
    })
    .from(assignments)
    .innerJoin(agents, eq(assignments.workerAgentId, agents.id))
    .innerJoin(jobs, eq(assignments.jobId, jobs.id))
    .where(
      and(
        eq(assignments.onChainSynced, false),
        eq(assignments.status, "in_progress")
      )
    );

  let synced = 0;
  let failed = 0;

  for (const row of unsynced) {
    try {
      if (!row.walletAddress) {
        console.error(`[seller-assignment-retry] Worker ${row.workerAgentId} has no wallet`);
        failed++;
        continue;
      }

      if (!row.budgetAmount) {
        failed++;
        continue;
      }

      const parsedAmount = parseFloat(row.escrowAmount);
      const parsedBudget = parseFloat(row.budgetAmount);

      if (parsedAmount < parsedBudget) {
        await oracleAssignSellerAndAdjust(
          row.jobId,
          row.walletAddress,
          row.escrowAmount,
        );
      } else {
        await oracleAssignSeller(row.jobId, row.walletAddress);
      }

      await db
        .update(assignments)
        .set({ onChainSynced: true })
        .where(eq(assignments.id, row.id));

      synced++;
    } catch (err) {
      console.error(
        `[seller-assignment-retry] Failed for assignment ${row.id}:`,
        err instanceof Error ? err.message : err
      );
      failed++;
    }
  }

  return { synced, failed };
}
