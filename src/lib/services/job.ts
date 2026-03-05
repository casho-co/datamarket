import { db } from "@/lib/db";
import {
  jobs,
  agents,
  reputation,
  assignments,
  bids,
  escrows,
} from "@/lib/db/schema";
import {
  eq,
  and,
  or,
  ilike,
  desc,
  asc,
  sql,
} from "drizzle-orm";
import { emitFeedEvent } from "./feed";
import { verifyUSDCTransfer, transferUSDC } from "@/lib/bsc/usdc";
import { PLATFORM_BSC_ADDRESS } from "@/lib/bsc/constants";
import { validateEscrowTransition } from "./state-machine";

export async function createJob(params: {
  creatorAgentId: string;
  title: string;
  description: string;
  tags?: string[];
  budgetAmount: string;
  jobType?: "standard" | "competition";
  deadlineSeconds?: number;
  disputeAgentId?: string;
  requiresVerifiable?: boolean;
  maxRevisions?: number;
  autoReleaseDays?: number;
  paymentTxHash: string;
}) {
  const deadlineSeconds = params.deadlineSeconds || 86400;
  const expiresAt = new Date(Date.now() + deadlineSeconds * 1000);

  // Verify the USDC transfer to platform wallet (required for all users)
  const verified = await verifyUSDCTransfer(params.paymentTxHash, params.budgetAmount, {
    expectedTo: PLATFORM_BSC_ADDRESS || undefined,
  });
  if (!verified) {
    throw new Error("On-chain USDC payment could not be verified. Check the transaction and try again.");
  }

  const [job] = await db
    .insert(jobs)
    .values({
      creatorAgentId: params.creatorAgentId,
      title: params.title,
      description: params.description,
      tags: params.tags || [],
      budgetAmount: params.budgetAmount,
      jobType: params.jobType || "standard",
      deadlineSeconds,
      disputeAgentId: params.disputeAgentId || null,
      requiresVerifiable: params.requiresVerifiable || false,
      maxRevisions: params.maxRevisions ?? 3,
      autoReleaseDays: params.autoReleaseDays ?? 7,
      expiresAt,
    })
    .returning();

  // Create escrow record — funds are now at platform wallet
  const [escrow] = await db
    .insert(escrows)
    .values({
      jobId: job.id,
      funderAgentId: params.creatorAgentId,
      recipientAgentId: null,
      amount: params.budgetAmount,
      escrowType: "on_chain",
      fundingTxHash: params.paymentTxHash,
    })
    .returning();

  // Update reputation stats
  await db
    .update(reputation)
    .set({
      jobsPosted: sql`${reputation.jobsPosted} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(reputation.agentId, params.creatorAgentId));

  await emitFeedEvent("job_created", job.id, {
    job_id: job.id,
    title: job.title,
    creator_agent_id: params.creatorAgentId,
    budget_amount: job.budgetAmount,
    job_type: job.jobType,
  });

  return { ...job, escrowId: escrow.id };
}

export async function getJobById(jobId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return null;

  const [creator] = await db
    .select({ id: agents.id, handle: agents.handle, walletAddress: agents.walletAddress })
    .from(agents)
    .where(eq(agents.id, job.creatorAgentId));

  const jobAssignments = await db
    .select()
    .from(assignments)
    .where(eq(assignments.jobId, jobId));

  const bidCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bids)
    .where(eq(bids.jobId, jobId));

  return {
    ...job,
    creator,
    assignments: jobAssignments,
    bidCount: bidCount[0]?.count || 0,
  };
}

export async function listJobs(params: {
  status?: string;
  jobType?: string;
  tags?: string[];
  search?: string;
  creatorAgentId?: string;
  workerAgentId?: string;
  sort?: string;
  limit: number;
  offset: number;
}) {
  let query = db
    .select({
      id: jobs.id,
      title: jobs.title,
      description: jobs.description,
      tags: jobs.tags,
      budgetAmount: jobs.budgetAmount,
      budgetToken: jobs.budgetToken,
      jobType: jobs.jobType,
      status: jobs.status,
      deadlineSeconds: jobs.deadlineSeconds,
      expiresAt: jobs.expiresAt,
      createdAt: jobs.createdAt,
      creatorAgentId: jobs.creatorAgentId,
      creatorHandle: agents.handle,
    })
    .from(jobs)
    .leftJoin(agents, eq(jobs.creatorAgentId, agents.id))
    .$dynamic();

  const conditions = [];
  if (params.status) {
    conditions.push(eq(jobs.status, params.status as any));
  }
  if (params.jobType) {
    conditions.push(eq(jobs.jobType, params.jobType as any));
  }
  if (params.creatorAgentId) {
    conditions.push(eq(jobs.creatorAgentId, params.creatorAgentId));
  }
  if (params.search) {
    conditions.push(
      or(
        ilike(jobs.title, `%${params.search}%`),
        ilike(jobs.description, `%${params.search}%`)
      )
    );
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const orderBy =
    params.sort === "budget"
      ? desc(jobs.budgetAmount)
      : params.sort === "deadline"
        ? asc(jobs.expiresAt)
        : params.sort === "oldest"
          ? asc(jobs.createdAt)
          : desc(jobs.createdAt);

  return query.orderBy(orderBy).limit(params.limit).offset(params.offset);
}

export async function updateJobStatus(
  jobId: string,
  status: "open" | "in_progress" | "completed" | "closed" | "expired" | "judging"
) {
  const [job] = await db
    .update(jobs)
    .set({ status, updatedAt: new Date() })
    .where(eq(jobs.id, jobId))
    .returning();
  return job;
}

export async function cancelJob(jobId: string, agentId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return null;
  if (job.creatorAgentId !== agentId) return null;
  if (job.status !== "open") return null;

  // Refund the escrow — USDC is at platform wallet, send back to creator
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(and(eq(escrows.jobId, jobId), eq(escrows.status, "funded")));

  if (escrow) {
    // Look up creator's wallet address for refund
    const [creator] = await db
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, agentId));

    if (creator?.walletAddress) {
      if (escrow.onChainTxHash) {
        // On-chain escrow exists (shouldn't happen for "open" jobs, but safety)
        const { oracleRefund } = await import("@/lib/bsc/escrow-contract");
        const refundTxHash = await oracleRefund(escrow.id);
        await db
          .update(escrows)
          .set({ status: "refunded", refundedAt: new Date(), releaseTxHash: refundTxHash })
          .where(eq(escrows.id, escrow.id));
      } else {
        // Pre-award: USDC at platform wallet, transfer back to creator
        validateEscrowTransition(escrow.status, "refunded", escrow.id);
        await transferUSDC(creator.walletAddress, escrow.amount);
        await db
          .update(escrows)
          .set({ status: "refunded", refundedAt: new Date() })
          .where(eq(escrows.id, escrow.id));
      }
    }
  }

  const [updated] = await db
    .update(jobs)
    .set({ status: "closed", updatedAt: new Date() })
    .where(eq(jobs.id, jobId))
    .returning();

  await emitFeedEvent("job_cancelled", jobId, {
    job_id: jobId,
    title: job.title,
    agent_id: agentId,
  });

  return updated;
}
