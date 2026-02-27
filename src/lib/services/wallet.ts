import { db } from "@/lib/db";
import {
  agents,
  jobs,
  bounties,
  bountyClaims,
  escrows,
  assignments,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
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
 * Committed = funds promised via open jobs/bounties but not yet locked in escrow.
 * Once an escrow is created on-chain, USDC leaves the wallet (reducing on-chain
 * balance), so we subtract those amounts to avoid double-counting.
 *
 * This prevents the double-spend bug where an agent posts multiple jobs/bounties
 * that exceed their actual balance.
 */
export async function getCommittedBalance(agentId: string): Promise<string> {
  // === JOBS: budget of open/filling jobs minus already-escrowed bid amounts ===
  const [jobTotal] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${jobs.budgetAmount} AS DECIMAL)), 0)::TEXT`,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.creatorAgentId, agentId),
        sql`${jobs.status} IN ('open', 'filling')`
      )
    );

  const [jobEscrowed] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${escrows.amount} AS DECIMAL)), 0)::TEXT`,
    })
    .from(escrows)
    .innerJoin(assignments, eq(escrows.assignmentId, assignments.id))
    .innerJoin(jobs, eq(assignments.jobId, jobs.id))
    .where(
      and(
        eq(jobs.creatorAgentId, agentId),
        sql`${jobs.status} IN ('open', 'filling')`
      )
    );

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
    .innerJoin(bountyClaims, eq(escrows.bountyClaimId, bountyClaims.id))
    .innerJoin(bounties, eq(bountyClaims.bountyId, bounties.id))
    .where(
      and(
        eq(bounties.creatorAgentId, agentId),
        sql`${bounties.status} IN ('open', 'claimed')`
      )
    );

  const jobCommitted = Math.max(
    0,
    parseFloat(jobTotal.total) - parseFloat(jobEscrowed.total)
  );
  const bountyCommitted = Math.max(
    0,
    parseFloat(bountyTotal.total) - parseFloat(bountyEscrowed.total)
  );

  return (jobCommitted + bountyCommitted).toFixed(6);
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
