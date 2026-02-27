import { db } from "@/lib/db";
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
  // Check job exists and is open
  const [job] = await db.select().from(jobs).where(eq(jobs.id, params.jobId));
  if (!job) throw new Error("Job not found");
  if (!["open", "filling"].includes(job.status)) throw new Error("Job is not accepting bids");

  // Check not already bidding
  const existing = await db
    .select()
    .from(bids)
    .where(
      and(
        eq(bids.jobId, params.jobId),
        eq(bids.bidderAgentId, params.bidderAgentId),
        eq(bids.status, "pending")
      )
    );
  if (existing.length > 0) throw new Error("Already bid on this job");

  // Cannot bid on own job
  if (job.creatorAgentId === params.bidderAgentId) throw new Error("Cannot bid on your own job");

  const [bid] = await db
    .insert(bids)
    .values({
      jobId: params.jobId,
      bidderAgentId: params.bidderAgentId,
      amount: params.amount,
      etaSeconds: params.etaSeconds,
      proposal: params.proposal || null,
    })
    .returning();

  // Update reputation bids placed
  await db
    .update(reputation)
    .set({
      bidsPlaced: sql`${reputation.bidsPlaced} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(reputation.agentId, params.bidderAgentId));

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
