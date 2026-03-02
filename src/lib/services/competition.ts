import { db, withTransaction, type TX } from "@/lib/db";
import {
  competitionEntries,
  jobs,
  agents,
  escrows,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { checkSufficientBalance } from "./wallet";
import { emitFeedEvent } from "./feed";
import { validateJobTransition } from "./state-machine";
import {
  agentCreateEscrow,
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

    // Verify creator has sufficient on-chain USDC balance
    const hasFunds = await checkSufficientBalance(params.judgeAgentId, totalDistributed.toString());
    if (!hasFunds) throw new Error("Insufficient on-chain USDC balance to fund prizes");

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

      // Create on-chain escrow (agent signs tx separately; release deferred)
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
            // Create escrow DB record
            const [escrow] = await tx
              .insert(escrows)
              .values({
                funderAgentId: params.judgeAgentId,
                recipientAgentId: entry.agentId,
                amount: prizeAmount.toFixed(6),
                escrowType: "on_chain",
              })
              .returning();

            // Build unsigned escrow tx for the agent to sign
            const escrowResult = agentCreateEscrow({
              walletAddress: funder.walletAddress,
              escrowId: escrow.id,
              sellerAddress: recipient.walletAddress,
              token: "USDC",
              amount: prizeAmount.toFixed(6),
              deadlineHours: DEFAULT_DEADLINE_HOURS,
              disputeWindowHours: DEFAULT_DISPUTE_WINDOW_HOURS,
            });

            // Store unsigned tx reference; release deferred until agent signs
            await tx
              .update(competitionEntries)
              .set({ escrowId: escrow.id })
              .where(eq(competitionEntries.id, prize.entryId));
          } catch {
            // On-chain payment failed for this winner — no off-chain balance to restore
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
