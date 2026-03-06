import { db, withTransaction, type TX } from "@/lib/db";
import {
  assignments,
  escrows,
  jobs,
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
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.status, "submitted"),
        isNotNull(assignments.autoReleaseAt),
        lte(assignments.autoReleaseAt, now)
      )
    );

  for (const assignment of overdueAssignments) {
    try {
      await withTransaction(async (tx: TX) => {
        validateAssignmentTransition(assignment.status, "accepted", assignment.id);

        const [escrow] = await tx
          .select()
          .from(escrows)
          .where(eq(escrows.assignmentId, assignment.id));

        if (escrow && escrow.status === "funded" && escrow.onChainTxHash) {
          const ready = await checkAutoReleaseReady(escrow.id);
          if (!ready) return;
          validateEscrowTransition(escrow.status, "released", escrow.id);
          const releaseTxHash = await oracleRelease(escrow.id);
          await tx
            .update(escrows)
            .set({ status: "released", releasedAt: now, releaseTxHash })
            .where(eq(escrows.id, escrow.id));

          await tx
            .update(reputation)
            .set({
              completedJobs: sql`${reputation.completedJobs} + 1`,
              totalEarned: sql`(CAST(${reputation.totalEarned} AS DECIMAL) + ${parseFloat(escrow.amount)})::TEXT`,
              updatedAt: now,
            })
            .where(eq(reputation.agentId, assignment.workerAgentId));
        }

        await tx
          .update(assignments)
          .set({ status: "accepted" })
          .where(eq(assignments.id, assignment.id));
      });

      await emitFeedEvent("auto_release", assignment.jobId, {
        job_id: assignment.jobId,
        assignment_id: assignment.id,
        reason: "Auto-released: creator did not review within deadline",
      });

      released++;
    } catch {
      // Continue
    }
  }

  // ── 2. Tasks ──
  const overdueTasks = await db
    .select()
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
      await withTransaction(async (tx: TX) => {
        validateTaskTransition(task.status, "completed", task.id);

        if (task.escrowId) {
          const [escrow] = await tx
            .select()
            .from(escrows)
            .where(eq(escrows.id, task.escrowId));

          if (escrow && escrow.status === "funded" && escrow.onChainTxHash) {
            const ready = await checkAutoReleaseReady(escrow.id);
            if (!ready) return;
            validateEscrowTransition(escrow.status, "released", escrow.id);
            const releaseTxHash = await oracleRelease(escrow.id);
            await tx
              .update(escrows)
              .set({ status: "released", releasedAt: now, releaseTxHash })
              .where(eq(escrows.id, escrow.id));

            await tx
              .update(reputation)
              .set({
                completedJobs: sql`${reputation.completedJobs} + 1`,
                totalEarned: sql`(CAST(${reputation.totalEarned} AS DECIMAL) + ${parseFloat(escrow.amount)})::TEXT`,
                updatedAt: now,
              })
              .where(eq(reputation.agentId, task.workerAgentId));
          }
        }

        await tx
          .update(tasks)
          .set({ status: "completed", updatedAt: now })
          .where(eq(tasks.id, task.id));
      });

      released++;
    } catch {
      // Continue
    }
  }

  // ── 3. Gig Orders ──
  const overdueGigOrders = await db
    .select()
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
      await withTransaction(async (tx: TX) => {
        validateGigOrderTransition(order.status, "completed", order.id);

        if (order.escrowId) {
          const [escrow] = await tx
            .select()
            .from(escrows)
            .where(eq(escrows.id, order.escrowId));

          if (escrow && escrow.status === "funded" && escrow.onChainTxHash) {
            const ready = await checkAutoReleaseReady(escrow.id);
            if (!ready) return;
            validateEscrowTransition(escrow.status, "released", escrow.id);
            const releaseTxHash = await oracleRelease(escrow.id);
            await tx
              .update(escrows)
              .set({ status: "released", releasedAt: now, releaseTxHash })
              .where(eq(escrows.id, escrow.id));
          }
        }

        await tx
          .update(gigOrders)
          .set({ status: "completed", completedAt: now })
          .where(eq(gigOrders.id, order.id));
      });

      released++;
    } catch {
      // Continue
    }
  }

  // ── 4. Bounty Claims ──
  const overdueClaims = await db
    .select()
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
      await withTransaction(async (tx: TX) => {
        validateBountyClaimTransition(claim.status, "accepted", claim.id);

        // Release on-chain escrow (funds go to claimer)
        if (claim.escrowId) {
          const [escrow] = await tx
            .select()
            .from(escrows)
            .where(eq(escrows.id, claim.escrowId));

          if (escrow && escrow.status === "funded" && escrow.onChainTxHash) {
            const ready = await checkAutoReleaseReady(escrow.id);
            if (!ready) return;
            validateEscrowTransition(escrow.status, "released", escrow.id);
            const releaseTxHash = await oracleRelease(escrow.id);
            await tx
              .update(escrows)
              .set({ status: "released", releasedAt: now, releaseTxHash })
              .where(eq(escrows.id, escrow.id));
          }
        }

        await tx
          .update(bountyClaims)
          .set({ status: "accepted" })
          .where(eq(bountyClaims.id, claim.id));
      });

      released++;
    } catch {
      // Continue
    }
  }

  // ── 5. On-Chain Escrow Auto-Release ──
  // Check on-chain escrows that are funded/delivered and past dispute window
  if (ESCROW_CONTRACT_ADDRESS) {
    const onChainEscrows = await db
      .select()
      .from(escrows)
      .where(
        and(
          eq(escrows.status, "funded"),
          isNotNull(escrows.onChainTxHash)
        )
      );

    for (const esc of onChainEscrows) {
      try {
        const ready = await checkAutoReleaseReady(esc.id);
        if (ready) {
          const releaseTxHash = await oracleRelease(esc.id);

          await db
            .update(escrows)
            .set({
              status: "released",
              releasedAt: now,
              releaseTxHash,
            })
            .where(eq(escrows.id, esc.id));

          released++;
        }
      } catch {
        // Continue — on-chain operations can fail due to gas, state, etc.
      }
    }
  }

  return { released };
}
