import { db } from "@/lib/db";
import {
  assignments,
  escrows,
  tasks,
  gigOrders,
  bountyClaims,
  reputation,
} from "@/lib/db/schema";
import { eq, and, lte, isNotNull, sql } from "drizzle-orm";
import { emitFeedEvent } from "@/lib/services/feed";
import {
  validateAssignmentTransition,
  validateEscrowTransition,
  validateTaskTransition,
  validateGigOrderTransition,
  validateBountyClaimTransition,
} from "@/lib/services/state-machine";
import { checkAutoReleaseReady, oracleRelease } from "@/lib/bsc/escrow-contract";
import { ESCROW_CONTRACT_ADDRESS } from "@/lib/bsc/constants";

/**
 * Helper: check on-chain readiness, release, then update DB.
 * On-chain calls happen BEFORE DB updates — no locks held during RPC.
 */
async function releaseEscrowIfReady(
  escrowId: string,
  escrowStatus: string,
  onChainTxHash: string | null,
  now: Date
): Promise<string | null> {
  if (escrowStatus !== "funded" || !onChainTxHash) return null;

  const ready = await checkAutoReleaseReady(escrowId);
  if (!ready) return null;

  validateEscrowTransition(escrowStatus, "released", escrowId);
  const releaseTxHash = await oracleRelease(escrowId);

  await db
    .update(escrows)
    .set({ status: "released", releasedAt: now, releaseTxHash })
    .where(eq(escrows.id, escrowId));

  return releaseTxHash;
}

/**
 * Auto-release escrow to workers for submitted work that hasn't been reviewed
 * within the auto-release deadline. This protects workers from unresponsive creators.
 *
 * Handles all 4 work models: assignments (jobs), tasks, gig orders, bounty claims.
 */
export async function runAutoRelease() {
  const now = new Date();
  let released = 0;

  // ── 1. Assignments (Jobs) ──
  const overdueAssignments = await db
    .select({
      id: assignments.id,
      jobId: assignments.jobId,
      workerAgentId: assignments.workerAgentId,
      status: assignments.status,
      escrowId: escrows.id,
      escrowStatus: escrows.status,
      escrowAmount: escrows.amount,
      onChainTxHash: escrows.onChainTxHash,
    })
    .from(assignments)
    .leftJoin(escrows, eq(escrows.assignmentId, assignments.id))
    .where(
      and(
        eq(assignments.status, "submitted"),
        isNotNull(assignments.autoReleaseAt),
        lte(assignments.autoReleaseAt, now)
      )
    );

  for (const row of overdueAssignments) {
    try {
      // On-chain release first
      let didRelease = false;
      if (row.escrowId && row.escrowStatus && row.onChainTxHash) {
        const txHash = await releaseEscrowIfReady(row.escrowId, row.escrowStatus, row.onChainTxHash, now);
        if (txHash) {
          await db
            .update(reputation)
            .set({
              completedJobs: sql`${reputation.completedJobs} + 1`,
              totalEarned: sql`(CAST(${reputation.totalEarned} AS DECIMAL) + ${parseFloat(row.escrowAmount || "0")})::TEXT`,
              updatedAt: now,
            })
            .where(eq(reputation.agentId, row.workerAgentId));
          didRelease = true;
        } else if (row.escrowStatus === "funded") {
          continue; // Not ready for release yet, skip
        }
      }

      validateAssignmentTransition(row.status, "accepted", row.id);
      await db
        .update(assignments)
        .set({ status: "accepted" })
        .where(eq(assignments.id, row.id));

      await emitFeedEvent("auto_release", row.jobId, {
        job_id: row.jobId,
        assignment_id: row.id,
        reason: "Auto-released: creator did not review within deadline",
      });

      released++;
    } catch {
      // Continue
    }
  }

  // ── 2. Tasks ──
  const overdueTasks = await db
    .select({
      id: tasks.id,
      status: tasks.status,
      workerAgentId: tasks.workerAgentId,
      escrowId: tasks.escrowId,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "submitted"),
        isNotNull(tasks.autoReleaseAt),
        lte(tasks.autoReleaseAt, now)
      )
    );

  for (const task of overdueTasks) {
    try {
      if (task.escrowId) {
        const [escrow] = await db
          .select({ id: escrows.id, status: escrows.status, onChainTxHash: escrows.onChainTxHash, amount: escrows.amount })
          .from(escrows)
          .where(eq(escrows.id, task.escrowId));

        if (escrow) {
          const txHash = await releaseEscrowIfReady(escrow.id, escrow.status, escrow.onChainTxHash, now);
          if (txHash && task.workerAgentId) {
            await db
              .update(reputation)
              .set({
                completedJobs: sql`${reputation.completedJobs} + 1`,
                totalEarned: sql`(CAST(${reputation.totalEarned} AS DECIMAL) + ${parseFloat(escrow.amount)})::TEXT`,
                updatedAt: now,
              })
              .where(eq(reputation.agentId, task.workerAgentId));
          } else if (escrow.status === "funded" && !txHash) {
            continue;
          }
        }
      }

      validateTaskTransition(task.status, "completed", task.id);
      await db
        .update(tasks)
        .set({ status: "completed", updatedAt: now })
        .where(eq(tasks.id, task.id));

      released++;
    } catch {
      // Continue
    }
  }

  // ── 3. Gig Orders ──
  const overdueGigOrders = await db
    .select({
      id: gigOrders.id,
      status: gigOrders.status,
      escrowId: gigOrders.escrowId,
    })
    .from(gigOrders)
    .where(
      and(
        eq(gigOrders.status, "delivered"),
        isNotNull(gigOrders.autoReleaseAt),
        lte(gigOrders.autoReleaseAt, now)
      )
    );

  for (const order of overdueGigOrders) {
    try {
      if (order.escrowId) {
        const [escrow] = await db
          .select({ id: escrows.id, status: escrows.status, onChainTxHash: escrows.onChainTxHash })
          .from(escrows)
          .where(eq(escrows.id, order.escrowId));

        if (escrow) {
          const txHash = await releaseEscrowIfReady(escrow.id, escrow.status, escrow.onChainTxHash, now);
          if (escrow.status === "funded" && !txHash) continue;
        }
      }

      validateGigOrderTransition(order.status, "completed", order.id);
      await db
        .update(gigOrders)
        .set({ status: "completed", completedAt: now })
        .where(eq(gigOrders.id, order.id));

      released++;
    } catch {
      // Continue
    }
  }

  // ── 4. Bounty Claims ──
  const overdueClaims = await db
    .select({
      id: bountyClaims.id,
      status: bountyClaims.status,
      escrowId: bountyClaims.escrowId,
    })
    .from(bountyClaims)
    .where(
      and(
        eq(bountyClaims.status, "submitted"),
        isNotNull(bountyClaims.autoReleaseAt),
        lte(bountyClaims.autoReleaseAt, now)
      )
    );

  for (const claim of overdueClaims) {
    try {
      if (claim.escrowId) {
        const [escrow] = await db
          .select({ id: escrows.id, status: escrows.status, onChainTxHash: escrows.onChainTxHash })
          .from(escrows)
          .where(eq(escrows.id, claim.escrowId));

        if (escrow) {
          const txHash = await releaseEscrowIfReady(escrow.id, escrow.status, escrow.onChainTxHash, now);
          if (escrow.status === "funded" && !txHash) continue;
        }
      }

      validateBountyClaimTransition(claim.status, "accepted", claim.id);
      await db
        .update(bountyClaims)
        .set({ status: "accepted" })
        .where(eq(bountyClaims.id, claim.id));

      released++;
    } catch {
      // Continue
    }
  }

  // ── 5. On-Chain Escrow Auto-Release ──
  if (ESCROW_CONTRACT_ADDRESS) {
    const onChainEscrows = await db
      .select({ id: escrows.id, status: escrows.status, onChainTxHash: escrows.onChainTxHash })
      .from(escrows)
      .where(
        and(
          eq(escrows.status, "funded"),
          isNotNull(escrows.onChainTxHash)
        )
      );

    for (const esc of onChainEscrows) {
      try {
        const txHash = await releaseEscrowIfReady(esc.id, esc.status, esc.onChainTxHash, now);
        if (txHash) released++;
      } catch {
        // Continue
      }
    }
  }

  return { released };
}
