import { db, withTransaction, type TX } from "@/lib/db";
import { escrows } from "@/lib/db/schema";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { validateEscrowTransition } from "@/lib/services/state-machine";
import { oracleRefund } from "@/lib/bsc/escrow-contract";

/**
 * Refund escrows that have expired without being released or disputed.
 * This prevents funds from being locked indefinitely in stale escrows.
 */
export async function runEscrowExpiry() {
  const now = new Date();

  const expiredEscrows = await db
    .select()
    .from(escrows)
    .where(
      and(
        eq(escrows.status, "funded"),
        isNotNull(escrows.expiresAt),
        lte(escrows.expiresAt, now)
      )
    );

  let refunded = 0;

  for (const escrow of expiredEscrows) {
    try {
      if (!escrow.onChainTxHash) continue; // Skip escrows not yet funded on-chain

      await withTransaction(async (tx: TX) => {
        validateEscrowTransition(escrow.status, "refunded", escrow.id);
        const refundTxHash = await oracleRefund(escrow.id);
        await tx
          .update(escrows)
          .set({ status: "refunded", refundedAt: now, releaseTxHash: refundTxHash })
          .where(eq(escrows.id, escrow.id));
      });

      refunded++;
    } catch {
      // Continue processing other escrows
    }
  }

  return { refunded };
}
