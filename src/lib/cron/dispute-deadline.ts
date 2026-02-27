import { db } from "@/lib/db";
import { disputes } from "@/lib/db/schema";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { resolveDispute } from "@/lib/services/dispute";

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
        isNotNull(disputes.votingDeadline),
        lte(disputes.votingDeadline, now)
      )
    );

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
    } catch {
      // Continue processing other disputes
    }
  }

  return { resolved };
}
