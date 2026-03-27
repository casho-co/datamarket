import { db } from "@/lib/db";
import {
  jobs,
  agents,
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
import { agentCreateEscrow } from "@/lib/bsc/escrow-contract";
import { DEFAULT_DEADLINE_HOURS, DEFAULT_DISPUTE_WINDOW_HOURS } from "@/lib/bsc/constants";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
}) {
  const deadlineSeconds = params.deadlineSeconds || 86400;
  const expiresAt = new Date(Date.now() + deadlineSeconds * 1000);

  // Create job as unverified draft — no escrow row, no money yet
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
      verified: false,
    })
    .returning();

  // Look up creator's wallet to build unsigned TXes
  const [creator] = await db
    .select({ walletAddress: agents.walletAddress })
    .from(agents)
    .where(eq(agents.id, params.creatorAgentId));

  if (!creator?.walletAddress) {
    throw new Error("Creator wallet address not found");
  }

  // Build unsigned TXes: approve USDC + createEscrow with seller=address(0)
  const escrowResult = agentCreateEscrow({
    walletAddress: creator.walletAddress,
    refId: job.id,
    sellerAddress: ZERO_ADDRESS,
    token: "USDC",
    amount: params.budgetAmount,
    deadlineHours: DEFAULT_DEADLINE_HOURS,
    disputeWindowHours: DEFAULT_DISPUTE_WINDOW_HOURS,
  });

  // Feed event deferred until verify-funding verifies on-chain funding
  return {
    ...job,
    unsigned_txs: escrowResult.unsignedTxs,
    amountWei: escrowResult.amountWei,
  };
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

  // Public queries only see verified jobs; creator's own queries see all
  if (!params.creatorAgentId) {
    conditions.push(eq(jobs.verified, true));
  }

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

  if (job.verified) {
    // Verified job — find escrow and refund on-chain
    const [escrow] = await db
      .select()
      .from(escrows)
      .where(and(eq(escrows.refId, jobId), eq(escrows.refType, "job"), eq(escrows.status, "funded")));

    if (escrow && escrow.onChainTxHash) {
      const { oracleRefund } = await import("@/lib/bsc/escrow-contract");
      const refundTxHash = await oracleRefund(jobId);
      await db
        .update(escrows)
        .set({ status: "refunded", refundedAt: new Date(), releaseTxHash: refundTxHash })
        .where(eq(escrows.id, escrow.id));
    }
  }
  // Unverified job — no escrow, no money, just close

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
