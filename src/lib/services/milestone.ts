import { db, withTransaction, type TX } from "@/lib/db";
import { escrowMilestones, escrows, tokenLaunches } from "@/lib/db/schema";
import { eq, and, sql, asc } from "drizzle-orm";
import { oracleRelease as onChainRelease } from "@/lib/bsc/escrow-contract";
import { processPaymentWithBuyback, type BuybackResult } from "@/lib/bsc/buyback";

/**
 * Look up an agent's launched token address (Four.meme token).
 * Returns the token address if the agent has a successfully launched token, null otherwise.
 */
async function getAgentTokenAddress(agentId: string): Promise<string | null> {
  const [launch] = await db
    .select({ tokenAddress: tokenLaunches.tokenAddress })
    .from(tokenLaunches)
    .where(
      and(
        eq(tokenLaunches.agentId, agentId),
        eq(tokenLaunches.status, "launched")
      )
    )
    .limit(1);
  return launch?.tokenAddress || null;
}

/**
 * Execute buyback-and-burn for a worker agent's token after escrow release.
 * If the agent has a launched token, a % of the released payment is used to
 * buy and burn their token via PancakeSwap (LiFi aggregator).
 *
 * This is best-effort — if buyback fails, the payment still goes through.
 */
async function tryBuybackForAgent(
  workerAgentId: string,
  escrowAmount: string,
  escrowId: string
): Promise<BuybackResult | null> {
  try {
    const tokenAddress = await getAgentTokenAddress(workerAgentId);
    if (!tokenAddress) return null; // No token — no buyback

    const result = await processPaymentWithBuyback({
      totalAmount: escrowAmount,
      tokenAddress,
    });

    // Log the buyback result to the escrow record
    if (result.swapTxHash || result.burnTxHash) {
      await db
        .update(escrows)
        .set({
          buybackTxHash: result.swapTxHash,
          buybackBurnTxHash: result.burnTxHash,
          buybackAmount: result.buybackAmount,
          buybackTokensBurned: result.tokensBurned,
          buybackTokenAddress: result.tokenAddress,
        })
        .where(eq(escrows.id, escrowId));
    }

    return result;
  } catch (err) {
    console.error(
      `Buyback failed for agent ${workerAgentId}:`,
      err instanceof Error ? err.message : err
    );
    return null; // Buyback failure is non-fatal
  }
}

export async function createMilestones(params: {
  escrowId: string;
  agentId: string;
  milestones: { title: string; amount: string }[];
}) {
  // Verify escrow exists and agent is the funder
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, params.escrowId));

  if (!escrow) throw new Error("Escrow not found");
  if (escrow.funderAgentId !== params.agentId) throw new Error("Not escrow funder");
  if (escrow.status !== "funded") throw new Error("Escrow not in funded status");

  // Verify total milestone amounts equal escrow amount
  const totalMilestone = params.milestones.reduce(
    (sum, m) => sum + parseFloat(m.amount),
    0
  );
  const escrowAmount = parseFloat(escrow.amount);

  if (Math.abs(totalMilestone - escrowAmount) > 0.000001) {
    throw new Error(
      `Milestone amounts (${totalMilestone}) must equal escrow amount (${escrowAmount})`
    );
  }

  // Check no milestones already exist
  const existing = await db
    .select()
    .from(escrowMilestones)
    .where(eq(escrowMilestones.escrowId, params.escrowId));

  if (existing.length > 0) {
    throw new Error("Milestones already created for this escrow");
  }

  const values = params.milestones.map((m, i) => ({
    escrowId: params.escrowId,
    title: m.title,
    amount: m.amount,
    orderIndex: i,
  }));

  const created = await db
    .insert(escrowMilestones)
    .values(values)
    .returning();

  return created;
}

export async function listMilestones(escrowId: string) {
  return db
    .select()
    .from(escrowMilestones)
    .where(eq(escrowMilestones.escrowId, escrowId))
    .orderBy(asc(escrowMilestones.orderIndex));
}

export async function releaseMilestone(params: {
  milestoneId: string;
  agentId: string;
}) {
  const result = await withTransaction(async (tx: TX) => {
    const [milestone] = await tx
      .select()
      .from(escrowMilestones)
      .where(eq(escrowMilestones.id, params.milestoneId));

    if (!milestone) throw new Error("Milestone not found");
    if (milestone.status !== "pending") throw new Error("Milestone already processed");

    // Verify previous milestones are released (enforce order)
    const prior = await tx
      .select()
      .from(escrowMilestones)
      .where(
        and(
          eq(escrowMilestones.escrowId, milestone.escrowId),
          sql`${escrowMilestones.orderIndex} < ${milestone.orderIndex}`,
          sql`${escrowMilestones.status} != 'released'`
        )
      );

    if (prior.length > 0) {
      throw new Error("Previous milestones must be released first");
    }

    // Verify agent is the escrow funder
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, milestone.escrowId));

    if (!escrow) throw new Error("Escrow not found");
    if (escrow.funderAgentId !== params.agentId) throw new Error("Not escrow funder");

    // Mark milestone as released
    const [updated] = await tx
      .update(escrowMilestones)
      .set({ status: "released", releasedAt: new Date() })
      .where(eq(escrowMilestones.id, params.milestoneId))
      .returning();

    // Check if all milestones released → release on-chain escrow
    let releasedEscrow: { id: string; amount: string; recipientAgentId: string } | null = null;
    const remaining = await tx
      .select()
      .from(escrowMilestones)
      .where(
        and(
          eq(escrowMilestones.escrowId, milestone.escrowId),
          sql`${escrowMilestones.status} = 'pending'`
        )
      );

    if (remaining.length === 0) {
      // All milestones done — release full escrow on-chain
      if (!escrow.onChainTxHash) {
        throw new Error("On-chain escrow not yet funded on-chain");
      }
      const releaseTxHash = await onChainRelease(escrow.id);
      await tx
        .update(escrows)
        .set({ status: "released", releasedAt: new Date(), releaseTxHash })
        .where(eq(escrows.id, milestone.escrowId));
      if (escrow.recipientAgentId) {
        releasedEscrow = { id: escrow.id, amount: escrow.amount, recipientAgentId: escrow.recipientAgentId };
      }
    }

    return { milestone: updated, releasedEscrow };
  });

  // Post-tx: buyback-and-burn for recipient agent's token (best-effort, non-blocking)
  if (result.releasedEscrow) {
    tryBuybackForAgent(
      result.releasedEscrow.recipientAgentId,
      result.releasedEscrow.amount,
      result.releasedEscrow.id
    ).catch(() => {
      // Buyback is best-effort — failure does not affect the payment
    });
  }

  return result.milestone;
}
