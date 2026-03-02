import { db, withTransaction, type TX } from "@/lib/db";
import {
  bounties,
  bountyClaims,
  escrows,
  agents,
  reputation,
  submissionHistory,
  fileUploads,
} from "@/lib/db/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { checkSufficientBalance } from "./wallet";
import {
  validateBountyTransition,
  validateBountyClaimTransition,
} from "./state-machine";
import { updateReputation } from "./reputation";
import { giveOnChainFeedback } from "@/lib/bsc/erc8004";
import {
  agentCreateEscrow,
} from "@/lib/bsc/escrow-contract";
import {
  ESCROW_CONTRACT_ADDRESS,
  DEFAULT_DEADLINE_HOURS,
  DEFAULT_DISPUTE_WINDOW_HOURS,
} from "@/lib/bsc/constants";

const DEFAULT_AUTO_RELEASE_DAYS = 7;

// ── Create Bounty ──

export async function createBounty(params: {
  creatorAgentId: string;
  title: string;
  description: string;
  reward: string;
  tags?: string[];
  maxClaims?: number;
  deadlineDays: number;
}) {
  // Verify creator has sufficient on-chain USDC balance
  const amount = parseFloat(params.reward);
  const totalReward = amount * (params.maxClaims ?? 1);
  const hasFunds = await checkSufficientBalance(params.creatorAgentId, totalReward.toString());
  if (!hasFunds) throw new Error("Insufficient on-chain USDC balance");

  const deadline = new Date(
      Date.now() + params.deadlineDays * 24 * 60 * 60 * 1000
    );

  const [bounty] = await db
    .insert(bounties)
    .values({
      creatorAgentId: params.creatorAgentId,
      title: params.title,
      description: params.description,
      reward: params.reward,
      tags: params.tags || [],
      maxClaims: params.maxClaims ?? 1,
      deadline,
    })
    .returning();

  return bounty;
}

// ── Claim Bounty ──

export async function claimBounty(params: {
  bountyId: string;
  claimerAgentId: string;
}) {
  return withTransaction(async (tx: TX) => {
    const [bounty] = await tx
      .select()
      .from(bounties)
      .where(eq(bounties.id, params.bountyId));

    if (!bounty) throw new Error("Bounty not found");
    if (bounty.creatorAgentId === params.claimerAgentId)
      throw new Error("Cannot claim your own bounty");
    if (bounty.status !== "open") throw new Error("Bounty not open");
    if (bounty.activeClaims >= bounty.maxClaims)
      throw new Error("All claim slots taken");

    // Check for existing claim
    const [existingClaim] = await tx
      .select()
      .from(bountyClaims)
      .where(
        and(
          eq(bountyClaims.bountyId, params.bountyId),
          eq(bountyClaims.claimerAgentId, params.claimerAgentId)
        )
      );
    if (existingClaim) throw new Error("Already claimed this bounty");

    const [claim] = await tx
      .insert(bountyClaims)
      .values({
        bountyId: params.bountyId,
        claimerAgentId: params.claimerAgentId,
      })
      .returning();

    // Update active claims count
    const newActiveClaims = bounty.activeClaims + 1;
    const newStatus =
      newActiveClaims >= bounty.maxClaims ? "claimed" : "open";

    if (newStatus !== bounty.status) {
      validateBountyTransition(bounty.status, newStatus, bounty.id);
    }

    await tx
      .update(bounties)
      .set({
        activeClaims: newActiveClaims,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(bounties.id, params.bountyId));

    return claim;
  });
}

// ── Submit Bounty Work ──

export async function submitBountyWork(params: {
  claimId: string;
  claimerAgentId: string;
  type: "url" | "file" | "inline" | "hash_only";
  deliverableUrl?: string;
  deliverableHash?: string;
  fileId?: string;
  inlineResponse?: string;
}) {
  const [claim] = await db
    .select()
    .from(bountyClaims)
    .where(eq(bountyClaims.id, params.claimId));

  if (!claim) throw new Error("Claim not found");
  if (claim.claimerAgentId !== params.claimerAgentId)
    throw new Error("Not the claimer");

  // If file type, verify the file belongs to this agent
  let resolvedUrl = params.deliverableUrl || null;
  if (params.type === "file" && params.fileId) {
    const [file] = await db
      .select()
      .from(fileUploads)
      .where(eq(fileUploads.id, params.fileId));
    if (!file) throw new Error("File not found");
    if (file.agentId !== params.claimerAgentId)
      throw new Error("File does not belong to this agent");
    resolvedUrl = `r2://${file.fileKey}`;
  }

  validateBountyClaimTransition(claim.status, "submitted", claim.id);

  const now = new Date();
  const autoReleaseAt = new Date(
    now.getTime() + DEFAULT_AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000
  );

  const [updated] = await db
    .update(bountyClaims)
    .set({
      status: "submitted",
      deliverableType: params.type,
      deliverableUrl: resolvedUrl,
      deliverableHash: params.deliverableHash || null,
      deliverableFileId: params.fileId || null,
      inlineResponse: params.inlineResponse || null,
      submittedAt: now,
      autoReleaseAt,
    })
    .where(eq(bountyClaims.id, params.claimId))
    .returning();

  // Record in submission history
  await db.insert(submissionHistory).values({
    bountyClaimId: params.claimId,
    submitterAgentId: params.claimerAgentId,
    revision: 1,
    deliverableType: params.type,
    deliverableUrl: resolvedUrl,
    deliverableHash: params.deliverableHash || null,
    deliverableFileId: params.fileId || null,
    inlineResponse: params.inlineResponse || null,
  });

  // Escrow is created at acceptBountyClaim(), not here.
  // Commitment tracking in checkSufficientBalance() guarantees funds
  // are reserved for this bounty since creation time.

  return updated;
}

// ── Accept Bounty Claim (pay reward on-chain) ──

export async function acceptBountyClaim(params: {
  bountyId: string;
  claimId: string;
  creatorAgentId: string;
}) {
  const result = await withTransaction(async (tx: TX) => {
    const [bounty] = await tx
      .select()
      .from(bounties)
      .where(eq(bounties.id, params.bountyId));

    if (!bounty) throw new Error("Bounty not found");
    if (bounty.creatorAgentId !== params.creatorAgentId)
      throw new Error("Not bounty creator");

    const [claim] = await tx
      .select()
      .from(bountyClaims)
      .where(eq(bountyClaims.id, params.claimId));

    if (!claim) throw new Error("Claim not found");
    if (claim.bountyId !== params.bountyId)
      throw new Error("Claim not for this bounty");

    validateBountyClaimTransition(claim.status, "accepted", claim.id);

    // Create escrow record (on-chain escrow + release happens after transaction)
    const [escrow] = await tx
      .insert(escrows)
      .values({
        bountyClaimId: params.claimId,
        funderAgentId: bounty.creatorAgentId,
        recipientAgentId: claim.claimerAgentId,
        amount: bounty.reward,
        escrowType: "on_chain",
      })
      .returning();

    // Update reputation
    const rewardAmount = parseFloat(bounty.reward);
    await tx
      .update(reputation)
      .set({
        completedJobs: sql`${reputation.completedJobs} + 1`,
        totalEarned: sql`(CAST(${reputation.totalEarned} AS DECIMAL) + ${rewardAmount})::TEXT`,
        updatedAt: new Date(),
      })
      .where(eq(reputation.agentId, claim.claimerAgentId));

    await tx
      .update(bountyClaims)
      .set({ status: "accepted", escrowId: escrow.id })
      .where(eq(bountyClaims.id, params.claimId));

    // Check if bounty is fully completed
    const acceptedCount = await tx
      .select({ id: bountyClaims.id })
      .from(bountyClaims)
      .where(
        and(
          eq(bountyClaims.bountyId, params.bountyId),
          eq(bountyClaims.status, "accepted")
        )
      );

    if (acceptedCount.length + 1 >= bounty.maxClaims) {
      validateBountyTransition(bounty.status, "completed", bounty.id);
      await tx
        .update(bounties)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(bounties.id, params.bountyId));
    }

    return { claim, bounty, escrow };
  });

  // Create on-chain escrow and release atomically (outside DB transaction)
  if (ESCROW_CONTRACT_ADDRESS && result.escrow) {
    const [funder] = await db
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, result.bounty.creatorAgentId));
    const [recipient] = await db
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, result.claim.claimerAgentId));

    if (funder?.walletAddress && recipient?.walletAddress) {
      // Build unsigned escrow transaction for the agent to sign
      const escrowResult = agentCreateEscrow({
        walletAddress: funder.walletAddress,
        escrowId: result.escrow.id,
        sellerAddress: recipient.walletAddress,
        token: "USDC",
        amount: result.bounty.reward,
        deadlineHours: DEFAULT_DEADLINE_HOURS,
        disputeWindowHours: DEFAULT_DISPUTE_WINDOW_HOURS,
      });

      // Attach unsigned tx to the result for the API to return to the agent.
      // The agent signs and submits these transactions locally.
      (result.escrow as Record<string, unknown>).unsignedTx = escrowResult.unsignedTx;
    }
  }

  await updateReputation(result.claim.claimerAgentId);

  // On-chain reputation feedback for bounty completion
  try {
    const [worker] = await db
      .select({ erc8004AgentId: agents.erc8004AgentId, mcpEndpoint: agents.mcpEndpoint })
      .from(agents)
      .where(eq(agents.id, result.claim.claimerAgentId));
    if (worker?.erc8004AgentId) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://datalayer-market.fly.dev";
      await giveOnChainFeedback({
        agentId: worker.erc8004AgentId,
        value: 100,
        tag1: "bounty",
        tag2: "completed",
        feedbackURI: `${baseUrl}/api/v1/bounties/${params.bountyId}`,
        endpoint: worker.mcpEndpoint || "",
      });
    }
  } catch {
    // On-chain feedback is best-effort
  }

  return { success: true };
}

// ── Cancel Bounty ──

export async function cancelBounty(params: {
  bountyId: string;
  creatorAgentId: string;
}) {
  return withTransaction(async (tx: TX) => {
    const [bounty] = await tx
      .select()
      .from(bounties)
      .where(eq(bounties.id, params.bountyId));

    if (!bounty) throw new Error("Bounty not found");
    if (bounty.creatorAgentId !== params.creatorAgentId)
      throw new Error("Not bounty creator");

    validateBountyTransition(bounty.status, "cancelled", bounty.id);

    // Calculate how many claims have been accepted (already paid on-chain)
    const acceptedClaims = await tx
      .select({ id: bountyClaims.id })
      .from(bountyClaims)
      .where(
        and(
          eq(bountyClaims.bountyId, params.bountyId),
          eq(bountyClaims.status, "accepted")
        )
      );

    // Reject all active/submitted claims (no escrow to refund — escrow is
    // only created at acceptance time, so unaccepted claims have no escrow)
    const pendingClaims = await tx
      .select({ id: bountyClaims.id })
      .from(bountyClaims)
      .where(
        and(
          eq(bountyClaims.bountyId, params.bountyId),
          inArray(bountyClaims.status, ["submitted", "active"])
        )
      );

    for (const claim of pendingClaims) {
      await tx
        .update(bountyClaims)
        .set({ status: "rejected" })
        .where(eq(bountyClaims.id, claim.id));
    }

    // No off-chain balance to refund — funds are in agent's own wallet.
    // No on-chain escrow refunds needed — escrow is only created at acceptance.

    const [updated] = await tx
      .update(bounties)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(bounties.id, params.bountyId))
      .returning();

    return updated;
  });
}

// ── List / Get ──

export async function getBountyById(bountyId: string) {
  const [bounty] = await db
    .select()
    .from(bounties)
    .where(eq(bounties.id, bountyId));
  return bounty || null;
}

export async function listBounties(params: {
  status?: string;
  sort?: string;
  limit: number;
  offset: number;
}) {
  let query = db.select().from(bounties).$dynamic();

  if (params.status) {
    query = query.where(
      eq(bounties.status, params.status as typeof bounties.status.enumValues[number])
    );
  }

  const orderBy =
    params.sort === "reward"
      ? sql`CAST(${bounties.reward} AS DECIMAL) DESC`
      : params.sort === "deadline"
        ? sql`${bounties.deadline} ASC`
        : desc(bounties.createdAt);

  return query.orderBy(orderBy).limit(params.limit).offset(params.offset);
}

export async function listBountyClaims(bountyId: string) {
  return db
    .select()
    .from(bountyClaims)
    .where(eq(bountyClaims.bountyId, bountyId))
    .orderBy(desc(bountyClaims.createdAt));
}
