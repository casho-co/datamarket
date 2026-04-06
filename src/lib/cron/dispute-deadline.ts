/**
 * Auto-resolves disputes where the resolver didn't act within the 7-day deadline.
 * Default ruling: worker_wins — protects the worker who delivered work.
 *
 * Example: A dispute is opened between Eve (creator) and Frank (worker). The
 * assigned resolver (AI or custom) never makes a ruling. After 7 days, this cron
 * resolves it as worker_wins — Frank gets paid, Eve's dispute deposit is lost.
 *
 * Without this: Disputes hang indefinitely if the resolver is unresponsive.
 */
import { db } from "@/lib/db";
import { disputes } from "@/lib/db/schema";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { resolveDispute } from "@/lib/services/dispute";
import { CRON_BATCH_LIMIT } from "@/lib/config";

/**
 * Auto-resolve disputes that have passed their voting deadline without resolution.
 * Default ruling: worker_wins (protects the worker who delivered work).
 */
export async function runDisputeDeadline() {
  const now = new Date();

  const expiredDisputes = await db
    .select()
    .from(disputes)
    .where(
      and(
        eq(disputes.ruling, "pending"),
        isNotNull(disputes.resolutionDeadline),
        lte(disputes.resolutionDeadline, now)
      )
    )
    .orderBy(disputes.resolutionDeadline)
    .limit(CRON_BATCH_LIMIT);

  let resolved = 0;

  for (const dispute of expiredDisputes) {
    try {
      // Default: worker_wins when resolver fails to act
      // Use the resolver if assigned, otherwise use a system agent placeholder
      const resolverAgentId =
        dispute.resolverAgentId || dispute.openerAgentId;

      await resolveDispute({
        disputeId: dispute.id,
        resolverAgentId,
        ruling: "worker_wins",
      });

      resolved++;
    } catch (err) {
      console.error(`[dispute-deadline] Failed for dispute ${dispute.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { resolved };
}
