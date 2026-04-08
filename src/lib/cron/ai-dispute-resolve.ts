/**
 * Processes pending disputes using the AI resolver agent.
 *
 * Example: A dispute is opened — the AI resolver is assigned. This cron picks it
 * up, calls resolveDisputeWithAI() which reads the submitted work, dispute reason,
 * and any evidence, then makes a ruling (worker_wins, requester_wins, split, redo).
 *
 * Also assigns orphaned disputes (no resolver set) to the AI resolver.
 *
 * Without this: AI disputes wait for the 7-day deadline fallback in dispute-deadline cron.
 */
import { db } from "@/lib/db";
import { agents, disputes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { CRON_BATCH_LIMIT } from "@/lib/config";

const AI_RESOLVER_HANDLE = process.env.PLATFORM_RESOLVER_HANDLE || "platform_resolver";

/**
 * Ensure the resolver agent has an on-chain ERC-8004 identity.
 * Mints one if missing — runs once, then no-ops on subsequent cron cycles.
 */
async function ensureResolverIdentity(resolver: { id: string; erc8004AgentId: bigint | null; walletAddress: string }) {
  if (resolver.erc8004AgentId) return;

  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://market.datalayer.xyz";
    const agentURI = `${baseUrl}/api/v1/agents/${resolver.id}`;

    const { getWalletClient, getPlatformAccount, getPublicClient } = await import("@/lib/bsc/client");
    const { ERC8004_IDENTITY_REGISTRY } = await import("@/lib/bsc/constants");

    const { bsc } = await import("viem/chains");

    const walletClient = getWalletClient();
    const account = getPlatformAccount();
    const publicClient = getPublicClient();

    const hash = await walletClient.writeContract({
      address: ERC8004_IDENTITY_REGISTRY as `0x${string}`,
      abi: [{
        name: "register",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "agentURI", type: "string" }],
        outputs: [{ name: "agentId", type: "uint256" }],
      }] as const,
      functionName: "register",
      args: [agentURI],
      account,
      chain: bsc,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Extract tokenId from Transfer event (mint: from=0x0)
    const { parseTokenIdFromReceipt } = await import("@/lib/bsc/erc8004");
    const tokenId = parseTokenIdFromReceipt(receipt);

    if (tokenId) {
      await db
        .update(agents)
        .set({ erc8004AgentId: tokenId })
        .where(eq(agents.id, resolver.id));
      console.log(`[AI-Resolve-Cron] Minted ERC-8004 identity for resolver: tokenId=${tokenId}`);
    }
  } catch (err) {
    console.error("[AI-Resolve-Cron] Failed to mint resolver identity:", err instanceof Error ? err.message : err);
  }
}

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

  // Ensure resolver has on-chain identity (mints once, no-ops after)
  await ensureResolverIdentity(resolver);

  // Assign unassigned pending disputes to the AI resolver
  const unassigned = await db
    .select()
    .from(disputes)
    .where(
      and(
        eq(disputes.ruling, "pending"),
        eq(disputes.resolverAgentId, resolver.id) // Already assigned
      )
    )
    .orderBy(disputes.createdAt)
    .limit(CRON_BATCH_LIMIT);

  // Also find disputes with no resolver assigned at all
  const { isNull } = await import("drizzle-orm");
  const orphaned = await db
    .select()
    .from(disputes)
    .where(
      and(eq(disputes.ruling, "pending"), isNull(disputes.resolverAgentId))
    )
    .orderBy(disputes.createdAt)
    .limit(CRON_BATCH_LIMIT);

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
