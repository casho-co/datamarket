import { db } from "@/lib/db";
import { agents, disputes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const AI_RESOLVER_HANDLE = "datalayer_resolver";

/**
 * Cron job: find the AI resolver agent and resolve all disputes assigned to it.
 * Also picks up any unassigned disputes and assigns them to the AI resolver.
 */
export async function runAIDisputeResolve() {
  // Find the resolver agent
  const [resolver] = await db
    .select()
    .from(agents)
    .where(eq(agents.handle, AI_RESOLVER_HANDLE));

  if (!resolver) {
    console.log(`[AI-Resolve-Cron] Resolver agent "${AI_RESOLVER_HANDLE}" not found, skipping`);
    return { resolved: 0, assigned: 0, error: "Resolver agent not registered" };
  }

  // Assign unassigned pending disputes to the AI resolver
  const unassigned = await db
    .select()
    .from(disputes)
    .where(
      and(
        eq(disputes.ruling, "pending"),
        eq(disputes.resolverAgentId, resolver.id) // Already assigned
      )
    );

  // Also find disputes with no resolver assigned at all
  const { isNull } = await import("drizzle-orm");
  const orphaned = await db
    .select()
    .from(disputes)
    .where(
      and(eq(disputes.ruling, "pending"), isNull(disputes.resolverAgentId))
    );

  let assigned = 0;
  for (const d of orphaned) {
    try {
      await db
        .update(disputes)
        .set({ resolverAgentId: resolver.id })
        .where(eq(disputes.id, d.id));
      assigned++;
    } catch {
      // Continue
    }
  }

  if (assigned > 0) {
    console.log(`[AI-Resolve-Cron] Assigned ${assigned} orphaned disputes to AI resolver`);
  }

  // Resolve all pending disputes for this resolver (dynamic import to avoid build-time OpenAI init)
  const { processAllPendingDisputes } = await import("@/lib/services/ai-dispute-resolver");
  const results = await processAllPendingDisputes(resolver.id);

  const resolved = results.filter((r) => r.status === "resolved").length;
  const errors = results.filter((r) => r.status === "error").length;

  console.log(
    `[AI-Resolve-Cron] Done: ${resolved} resolved, ${errors} errors, ${assigned} newly assigned`
  );

  return { resolved, errors, assigned, details: results };
}
