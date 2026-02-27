import { db, withTransaction, type TX } from "@/lib/db";
import { escrowMilestones, escrows } from "@/lib/db/schema";
import { eq, and, sql, asc } from "drizzle-orm";
import { oracleRelease as onChainRelease } from "@/lib/bsc/escrow-contract";

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
  return withTransaction(async (tx: TX) => {
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
    }

    return updated;
  });
}
