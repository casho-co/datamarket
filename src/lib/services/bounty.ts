import { db, withTransaction, type TX } from "@/lib/db";
import {
  bounties,
  bountyClaims,
  escrows,
  agentWallets,
  agents,
  reputation,
  submissionHistory,
  fileUploads,
} from "@/lib/db/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import {
  validateBountyTransition,
  validateBountyClaimTransition,
  validateEscrowTransition,
} from "./state-machine";
import { emitFeedEvent } from "./feed";
import { updateReputation } from "./reputation";
import {
  oracleCreateEscrow,
  oracleRelease,
  oracleRefund,
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
  // Verify creator has sufficient balance
  const amount = parseFloat(params.reward);
  const totalReward = amount * (params.maxClaims ?? 1);

  return withTransaction(async (tx: TX) => {
    // Debit creator for total potential reward (reserves custodied funds)
    const [debitResult] = await tx
      .update(agentWallets)
      .set({
        balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) - ${totalReward})::TEXT`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentWallets.agentId, params.creatorAgentId),
          sql`CAST(${agentWallets.balance} AS DECIMAL) >= ${totalReward}`
        )
      )
      .returning({ agentId: agentWallets.agentId });

    if (!debitResult) throw new Error("Insufficient balance");

    const deadline = new Date(
      Date.now() + params.deadlineDays * 24 * 60 * 60 * 1000
    );

    const [bounty] = await tx
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
  });
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

  // Create on-chain escrow for this claim (locks funds in smart contract)
  if (ESCROW_CONTRACT_ADDRESS) {
    const [bounty] = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, claim.bountyId));

    if (bounty) {
      const [funder] = await db
        .select({ walletAddress: agents.walletAddress })
        .from(agents)
        .where(eq(agents.id, bounty.creatorAgentId));
      const [recipient] = await db
        .select({ walletAddress: agents.walletAddress })
        .from(agents)
        .where(eq(agents.id, params.claimerAgentId));

      if (funder?.walletAddress && recipient?.walletAddress) {
        try {
          // Create escrow DB record
          const [escrow] = await db
            .insert(escrows)
            .values({
              bountyClaimId: params.claimId,
              funderAgentId: bounty.creatorAgentId,
              recipientAgentId: params.claimerAgentId,
              amount: bounty.reward,
              escrowType: "on_chain",
            })
            .returning();

          // Lock funds on-chain
          const txHash = await oracleCreateEscrow({
            escrowId: escrow.id,
            buyerAddress: funder.walletAddress,
            sellerAddress: recipient.walletAddress,
            token: "USDC",
            amount: bounty.reward,
            deadlineHours: DEFAULT_DEADLINE_HOURS,
            disputeWindowHours: DEFAULT_DISPUTE_WINDOW_HOURS,
          });

          // Update escrow with tx hash
          await db
            .update(escrows)
            .set({ onChainTxHash: txHash })
            .where(eq(escrows.id, escrow.id));

          // Link escrow to claim
          await db
            .update(bountyClaims)
            .set({ escrowId: escrow.id })
            .where(eq(bountyClaims.id, params.claimId));
        } catch {
          // Escrow creation failed — submission still recorded, escrow can be retried
        }
      }
    }
  }

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

    // Release escrow on-chain (funds go to claimer)
    if (claim.escrowId) {
      const [escrow] = await tx
        .select()
        .from(escrows)
        .where(eq(escrows.id, claim.escrowId));

      if (escrow && escrow.onChainTxHash) {
        validateEscrowTransition(escrow.status, "released", escrow.id);
        const releaseTxHash = await oracleRelease(escrow.id);
        await tx
          .update(escrows)
          .set({ status: "released", releasedAt: new Date(), releaseTxHash })
          .where(eq(escrows.id, escrow.id));
      }
    }

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
      .set({ status: "accepted" })
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

    return { claim, bounty };
  });

  await updateReputation(result.claim.claimerAgentId);
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

    // Refund on-chain escrows for submitted (unpaid) claims
    const submittedClaims = await tx
      .select({
        id: bountyClaims.id,
        escrowId: bountyClaims.escrowId,
      })
      .from(bountyClaims)
      .where(
        and(
          eq(bountyClaims.bountyId, params.bountyId),
          inArray(bountyClaims.status, ["submitted", "active"])
        )
      );

    for (const claim of submittedClaims) {
      if (claim.escrowId) {
        const [escrow] = await tx
          .select()
          .from(escrows)
          .where(eq(escrows.id, claim.escrowId));

        if (escrow && escrow.onChainTxHash && escrow.status === "funded") {
          try {
            validateEscrowTransition(escrow.status, "refunded", escrow.id);
            const refundTxHash = await oracleRefund(escrow.id);
            await tx
              .update(escrows)
              .set({
                status: "refunded",
                refundedAt: new Date(),
                releaseTxHash: refundTxHash,
              })
              .where(eq(escrows.id, escrow.id));
          } catch {
            // Continue with other refunds
          }
        }
      }

      // Reject the claim
      await tx
        .update(bountyClaims)
        .set({ status: "rejected" })
        .where(eq(bountyClaims.id, claim.id));
    }

    // Refund platform balance for unclaimed slots (no escrow was created)
    const paidClaims = acceptedClaims.length;
    const refundedClaims = submittedClaims.filter((c) => c.escrowId).length;
    const unclaimedSlots = bounty.maxClaims - paidClaims - refundedClaims;
    const unclaimedRefund = unclaimedSlots * parseFloat(bounty.reward);

    if (unclaimedRefund > 0) {
      await tx
        .update(agentWallets)
        .set({
          balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) + ${unclaimedRefund})::TEXT`,
          updatedAt: new Date(),
        })
        .where(eq(agentWallets.agentId, params.creatorAgentId));
    }

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
