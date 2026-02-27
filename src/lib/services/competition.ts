import { db, withTransaction, type TX } from "@/lib/db";
import {
  competitionEntries,
  jobs,
  agentWallets,
  agents,
  escrows,
} from "@/lib/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { emitFeedEvent } from "./feed";
import { validateJobTransition } from "./state-machine";
import {
  oracleCreateEscrow,
  oracleRelease,
} from "@/lib/bsc/escrow-contract";
import {
  ESCROW_CONTRACT_ADDRESS,
  DEFAULT_DEADLINE_HOURS,
  DEFAULT_DISPUTE_WINDOW_HOURS,
} from "@/lib/bsc/constants";

export async function submitEntry(params: {
  jobId: string;
  agentId: string;
  deliverableUrl: string;
  deliverableHash?: string;
}) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, params.jobId));
  if (!job) throw new Error("Job not found");
  if (job.jobType !== "competition") throw new Error("Not a competition");
  if (!["open", "filling"].includes(job.status))
    throw new Error("Competition not accepting entries");
  if (job.creatorAgentId === params.agentId)
    throw new Error("Creator cannot enter own competition");

  const [entry] = await db
    .insert(competitionEntries)
    .values({
      jobId: params.jobId,
      agentId: params.agentId,
      deliverableUrl: params.deliverableUrl,
      deliverableHash: params.deliverableHash || null,
    })
    .onConflictDoNothing()
    .returning();

  if (!entry) throw new Error("Already submitted an entry");

  await emitFeedEvent("competition_entry", params.jobId, {
    job_id: params.jobId,
    agent_id: params.agentId,
    entry_id: entry.id,
  });

  return entry;
}

export async function listEntries(jobId: string) {
  return db
    .select()
    .from(competitionEntries)
    .where(eq(competitionEntries.jobId, jobId))
    .orderBy(desc(competitionEntries.createdAt));
}

export async function resolveCompetition(params: {
  jobId: string;
  judgeAgentId: string;
  prizes: { entryId: string; bps: number }[];
}) {
  const result = await withTransaction(async (tx: TX) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, params.jobId));
    if (!job) throw new Error("Job not found");
    if (job.jobType !== "competition") throw new Error("Not a competition");
    if (job.creatorAgentId !== params.judgeAgentId)
      throw new Error("Not the judge");
    if (job.status !== "judging" && job.status !== "open")
      throw new Error("Competition not in judging phase");

    const totalBps = params.prizes.reduce((sum, p) => sum + p.bps, 0);
    if (totalBps > 10000)
      throw new Error("Total prize distribution exceeds 100%");

    const budgetAmount = parseFloat(job.budgetAmount || "0");
    if (budgetAmount <= 0) throw new Error("No prize pool");

    const totalDistributed = (budgetAmount * totalBps) / 10000;

    // Atomically debit the creator's balance to reserve prize funds
    const [debitResult] = await tx
      .update(agentWallets)
      .set({
        balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) - ${totalDistributed})::TEXT`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentWallets.agentId, params.judgeAgentId),
          sql`CAST(${agentWallets.balance} AS DECIMAL) >= ${totalDistributed}`
        )
      )
      .returning({ agentId: agentWallets.agentId });

    if (!debitResult) {
      throw new Error("Insufficient balance to fund prizes");
    }

    for (const prize of params.prizes) {
      const [entry] = await tx
        .select()
        .from(competitionEntries)
        .where(eq(competitionEntries.id, prize.entryId));
      if (!entry || entry.jobId !== params.jobId) continue;

      const prizeAmount = (budgetAmount * prize.bps) / 10000;

      await tx
        .update(competitionEntries)
        .set({ prizeBps: prize.bps })
        .where(eq(competitionEntries.id, prize.entryId));

      // Create on-chain escrow and immediately release to winner
      if (ESCROW_CONTRACT_ADDRESS && prizeAmount > 0) {
        const [funder] = await tx
          .select({ walletAddress: agents.walletAddress })
          .from(agents)
          .where(eq(agents.id, params.judgeAgentId));
        const [recipient] = await tx
          .select({ walletAddress: agents.walletAddress })
          .from(agents)
          .where(eq(agents.id, entry.agentId));

        if (funder?.walletAddress && recipient?.walletAddress) {
          try {
            // Create escrow
            const [escrow] = await tx
              .insert(escrows)
              .values({
                funderAgentId: params.judgeAgentId,
                recipientAgentId: entry.agentId,
                amount: prizeAmount.toFixed(6),
                escrowType: "on_chain",
              })
              .returning();

            const createTxHash = await oracleCreateEscrow({
              escrowId: escrow.id,
              buyerAddress: funder.walletAddress,
              sellerAddress: recipient.walletAddress,
              token: "USDC",
              amount: prizeAmount.toFixed(6),
              deadlineHours: DEFAULT_DEADLINE_HOURS,
              disputeWindowHours: DEFAULT_DISPUTE_WINDOW_HOURS,
            });

            await tx
              .update(escrows)
              .set({ onChainTxHash: createTxHash })
              .where(eq(escrows.id, escrow.id));

            // Immediately release to winner
            const releaseTxHash = await oracleRelease(escrow.id);

            await tx
              .update(escrows)
              .set({
                status: "released",
                releasedAt: new Date(),
                releaseTxHash,
              })
              .where(eq(escrows.id, escrow.id));

            // Track on the entry
            await tx
              .update(competitionEntries)
              .set({ escrowId: escrow.id, releaseTxHash })
              .where(eq(competitionEntries.id, prize.entryId));
          } catch {
            // On-chain payment failed for this winner — re-credit balance
            await tx
              .update(agentWallets)
              .set({
                balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) + ${prizeAmount})::TEXT`,
                updatedAt: new Date(),
              })
              .where(eq(agentWallets.agentId, params.judgeAgentId));
          }
        }
      }
    }

    // Mark competition completed
    validateJobTransition(job.status, "completed", params.jobId);
    await tx
      .update(jobs)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(jobs.id, params.jobId));

    return { distributed: params.prizes.length, totalBps };
  });

  await emitFeedEvent("competition_resolved", params.jobId, {
    job_id: params.jobId,
    judge_agent_id: params.judgeAgentId,
    prize_count: result.distributed,
  });

  return result;
}

// ── Get Competition Results ──

export async function getCompetitionResults(jobId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new Error("Job not found");
  if (job.jobType !== "competition") throw new Error("Not a competition");

  const budgetAmount = parseFloat(job.budgetAmount || "0");

  const entries = await db
    .select({
      id: competitionEntries.id,
      agentId: competitionEntries.agentId,
      agentHandle: agents.handle,
      deliverableUrl: competitionEntries.deliverableUrl,
      deliverableHash: competitionEntries.deliverableHash,
      prizeBps: competitionEntries.prizeBps,
      releaseTxHash: competitionEntries.releaseTxHash,
      createdAt: competitionEntries.createdAt,
    })
    .from(competitionEntries)
    .leftJoin(agents, eq(competitionEntries.agentId, agents.id))
    .where(eq(competitionEntries.jobId, jobId))
    .orderBy(desc(competitionEntries.prizeBps));

  const winners = entries
    .filter((e) => e.prizeBps && e.prizeBps > 0)
    .map((e, i) => ({
      rank: i + 1,
      entry_id: e.id,
      agent_id: e.agentId,
      agent_handle: e.agentHandle,
      prize_bps: e.prizeBps,
      prize_amount: ((budgetAmount * (e.prizeBps || 0)) / 10000).toFixed(6),
      release_tx_hash: e.releaseTxHash,
    }));

  return {
    job_id: jobId,
    title: job.title,
    status: job.status,
    prize_pool: job.budgetAmount,
    total_entries: entries.length,
    winners,
    entries: entries.map((e) => ({
      id: e.id,
      agent_id: e.agentId,
      agent_handle: e.agentHandle,
      deliverable_url: e.deliverableUrl,
      deliverable_hash: e.deliverableHash,
      prize_bps: e.prizeBps,
      release_tx_hash: e.releaseTxHash,
      created_at: e.createdAt,
    })),
  };
}
