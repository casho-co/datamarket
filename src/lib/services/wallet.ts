import { db } from "@/lib/db";
import {
  agents,
  bounties,
  bountyClaims,
  escrows,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { ESCROW_REF } from "@/lib/config";
import { getUSDCBalance } from "@/lib/bsc/usdc";

/**
 * Get an agent's on-chain USDC balance by reading their BSC wallet directly.
 */
export async function getAgentBalance(agentId: string): Promise<string> {
  const [agent] = await db
    .select({ walletAddress: agents.walletAddress })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agent?.walletAddress) return "0";
  return getUSDCBalance(agent.walletAddress);
}

/**
 * Get total committed but not yet on-chain amounts for an agent.
 *
 * Jobs no longer need committed balance tracking — USDC is transferred
 * to the platform wallet at job creation, so the on-chain balance already
 * reflects the deduction.
 *
 * Bounties still commit balance (reward * maxClaims) since they don't
 * transfer upfront.
 */
export async function getCommittedBalance(agentId: string): Promise<string> {
  // === BOUNTIES: reward * maxClaims minus already-escrowed claim amounts ===
  const [bountyTotal] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${bounties.reward} AS DECIMAL) * ${bounties.maxClaims}), 0)::TEXT`,
    })
    .from(bounties)
    .where(
      and(
        eq(bounties.creatorAgentId, agentId),
        sql`${bounties.status} IN ('open', 'claimed')`
      )
    );

  const [bountyEscrowed] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${escrows.amount} AS DECIMAL)), 0)::TEXT`,
    })
    .from(escrows)
    .innerJoin(bountyClaims, and(eq(escrows.refId, bountyClaims.id), eq(escrows.refType, ESCROW_REF.BOUNTY_CLAIM)))
    .innerJoin(bounties, eq(bountyClaims.bountyId, bounties.id))
    .where(
      and(
        eq(bounties.creatorAgentId, agentId),
        sql`${bounties.status} IN ('open', 'claimed')`
      )
    );

  const bountyCommitted = Math.max(
    0,
    parseFloat(bountyTotal.total) - parseFloat(bountyEscrowed.total)
  );

  return bountyCommitted.toFixed(6);
}

/**
 * Get an agent's available balance: on-chain USDC minus committed amounts.
 * This is what the agent can actually spend on new jobs, bounties, tasks, gigs.
 */
export async function getAvailableBalance(agentId: string): Promise<string> {
  const [onChain, committed] = await Promise.all([
    getAgentBalance(agentId),
    getCommittedBalance(agentId),
  ]);
  const available = parseFloat(onChain) - parseFloat(committed);
  return Math.max(0, available).toFixed(6);
}

/**
 * Check if an agent has sufficient available balance (accounting for commitments).
 * Prevents double-spending where an agent posts multiple jobs exceeding their balance.
 */
export async function checkSufficientBalance(
  agentId: string,
  amount: string
): Promise<boolean> {
  const available = await getAvailableBalance(agentId);
  return parseFloat(available) >= parseFloat(amount);
}
