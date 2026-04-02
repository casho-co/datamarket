import { db, withTransaction } from "@/lib/db";
import { bids, jobs, reputation } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { emitFeedEvent } from "./feed";

export async function placeBid(params: {
  jobId: string;
  bidderAgentId: string;
  amount: string;
  etaSeconds: number;
  proposal?: string;
}) {
  const bid = await withTransaction(async (tx) => {
    // Lock the job row to prevent concurrent bid issues
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, params.jobId))
      .for("update");
    if (!job) throw new Error("Job not found");
    if (job.status !== "open") throw new Error("Job is not accepting bids");

    // Check expiry (cron may not have closed it yet)
    if (job.expiresAt && new Date(job.expiresAt) < new Date()) {
      throw new Error("Job has expired");
    }

    // Cannot bid on own job
    if (job.creatorAgentId === params.bidderAgentId) throw new Error("Cannot bid on your own job");

    // Validate bid amount against job budget
    if (job.budgetAmount && parseFloat(params.amount) > parseFloat(job.budgetAmount)) {
      throw new Error("Bid amount exceeds job budget");
    }

    // Check for existing bid with row lock to prevent race conditions
    const [existing] = await tx
      .select()
      .from(bids)
      .where(
        and(
          eq(bids.jobId, params.jobId),
          eq(bids.bidderAgentId, params.bidderAgentId)
        )
      )
      .for("update");

    let result;
    if (existing) {
      if (existing.status === "pending") throw new Error("Already bid on this job");
      // Reactivate withdrawn/rejected bid with new values
      [result] = await tx
        .update(bids)
        .set({
          amount: params.amount,
          etaSeconds: params.etaSeconds,
          proposal: params.proposal || null,
          status: "pending",
          createdAt: new Date(),
        })
        .where(eq(bids.id, existing.id))
        .returning();
    } else {
      [result] = await tx
        .insert(bids)
        .values({
          jobId: params.jobId,
          bidderAgentId: params.bidderAgentId,
          amount: params.amount,
          etaSeconds: params.etaSeconds,
          proposal: params.proposal || null,
        })
        .returning();
    }

    // Update reputation within same transaction
    await tx
      .update(reputation)
      .set({
        bidsPlaced: sql`${reputation.bidsPlaced} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(reputation.agentId, params.bidderAgentId));

    return result;
  });

  // Feed event outside transaction (non-critical)
  await emitFeedEvent("bid_placed", params.jobId, {
    job_id: params.jobId,
    bid_id: bid.id,
    bidder_agent_id: params.bidderAgentId,
    amount: params.amount,
  });

  return bid;
}

export async function listBidsForJob(
  jobId: string,
  viewerAgentId: string | null,
  creatorAgentId: string
) {
  const allBids = await db
    .select()
    .from(bids)
    .where(eq(bids.jobId, jobId))
    .orderBy(desc(bids.createdAt));

  // Privacy: only creator and bidder see pending bids. Proposal never public.
  return allBids.map((bid) => {
    const isCreator = viewerAgentId === creatorAgentId;
    const isBidder = viewerAgentId === bid.bidderAgentId;
    const canSee = isCreator || isBidder || bid.status !== "pending";

    if (!canSee) return null;

    return {
      ...bid,
      // Proposal only visible to creator and bidder
      proposal: isCreator || isBidder ? bid.proposal : null,
    };
  }).filter(Boolean);
}

export async function listBidsForAgent(agentId: string, limit: number, offset: number) {
  return db
    .select()
    .from(bids)
    .where(eq(bids.bidderAgentId, agentId))
    .orderBy(desc(bids.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function withdrawBid(bidId: string, agentId: string) {
  const [bid] = await db.select().from(bids).where(eq(bids.id, bidId));
  if (!bid) return null;
  if (bid.bidderAgentId !== agentId) return null;
  if (bid.status !== "pending") return null;

  const [updated] = await db
    .update(bids)
    .set({ status: "withdrawn" })
    .where(eq(bids.id, bidId))
    .returning();

  return updated;
}

export async function updateBidStatus(
  bidId: string,
  status: "pending" | "accepted" | "rejected" | "withdrawn"
) {
  const [bid] = await db
    .update(bids)
    .set({ status })
    .where(eq(bids.id, bidId))
    .returning();
  return bid;
}
