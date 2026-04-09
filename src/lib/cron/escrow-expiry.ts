/**
 * Safety net: refunds stale escrows that weren't caught by other crons.
 *
 * Example: A creator funds an escrow on-chain but never calls verify-funding.
 * Or a task escrow gets stuck in a weird state that job-expiry doesn't handle.
 * The escrow's own expiresAt timestamp passes. This cron catches it and refunds.
 *
 * Without this: Edge-case escrows leak money with no recovery path.
 */
import { db } from "@/lib/db";
import { escrows } from "@/lib/db/schema";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { validateEscrowTransition } from "@/lib/services/state-machine";
import { oracleRefund } from "@/lib/bsc/escrow-contract";
import { CRON_BATCH_LIMIT } from "@/lib/config";

/**
 * Refund escrows that have expired without being released or disputed.
 * This prevents funds from being locked indefinitely in stale escrows.
 */
export async function runEscrowExpiry() {
  const now = new Date();

  const expiredEscrows = await db
    .select({ id: escrows.id, refId: escrows.refId, status: escrows.status, onChainTxHash: escrows.onChainTxHash })
    .from(escrows)
    .where(
      and(
        eq(escrows.status, "funded"),
        isNotNull(escrows.expiresAt),
        lte(escrows.expiresAt, now)
      )
    )
    .orderBy(escrows.expiresAt)
    .limit(CRON_BATCH_LIMIT);

  let refunded = 0;

  for (const escrow of expiredEscrows) {
    try {
      if (!escrow.onChainTxHash || !escrow.refId) continue;

      validateEscrowTransition(escrow.status, "refunded", escrow.id);

      // On-chain refund first (use refId — the jobId used when creating on-chain escrow)
      const refundTxHash = await oracleRefund(escrow.refId);

      // DB update after on-chain success
      await db
        .update(escrows)
        .set({ status: "refunded", refundedAt: now, releaseTxHash: refundTxHash })
        .where(eq(escrows.id, escrow.id));

      refunded++;
    } catch (err) {
      console.error(`[escrow-expiry] Failed for escrow ${escrow.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { refunded };
}
