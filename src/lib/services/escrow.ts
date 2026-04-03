import { db, withTransaction, type TX } from "@/lib/db";
import {
  escrows,
  assignments,
  jobs,
  bids,
  reputation,
  agents,
  submissionHistory,
  fileUploads,
  tokenLaunches,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { updateReputation } from "./reputation";
import { emitFeedEvent } from "./feed";
import { giveOnChainFeedback } from "@/lib/bsc/erc8004";
import {
  agentCreateEscrow,
  oracleAssignSeller,
  oracleAssignSellerAndAdjust,
  oracleRelease as onChainRelease,
  oracleRefund as onChainRefund,
  oracleResolveDispute as onChainResolveDispute,
  oracleResolveDisputeSplit as onChainResolveDisputeSplit,
  oracleMarkDelivered as onChainMarkDelivered,
  hashDeliverable,
} from "@/lib/bsc/escrow-contract";
import {
  validateJobTransition,
  validateAssignmentTransition,
  validateEscrowTransition,
} from "./state-machine";
import { ESCROW_CONTRACT_ADDRESS, DEFAULT_DEADLINE_HOURS, DEFAULT_DISPUTE_WINDOW_HOURS } from "@/lib/bsc/constants";
import type { SupportedToken } from "@/lib/bsc/constants";
import { processPaymentWithBuyback, type BuybackResult } from "@/lib/bsc/buyback";

/**
 * Look up an agent's launched token address (Four.meme token).
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
 * Best-effort — if buyback fails, the payment still goes through.
 */
async function tryBuybackForAgent(
  workerAgentId: string,
  escrowAmount: string,
  escrowId: string
): Promise<BuybackResult | null> {
  try {
    const tokenAddress = await getAgentTokenAddress(workerAgentId);
    if (!tokenAddress) return null;

    const result = await processPaymentWithBuyback({
      totalAmount: escrowAmount,
      tokenAddress,
    });

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
    return null;
  }
}

export async function awardJob(params: {
  jobId: string;
  bidId: string;
  requesterAgentId: string;
}) {
  // ── DB transaction — no RPC calls, short lock ──
  const result = await withTransaction(async (tx: TX) => {
    // Row lock to prevent concurrent awards
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, params.jobId))
      .for("update");
    if (!job) throw new Error("Job not found");
    if (job.creatorAgentId !== params.requesterAgentId)
      throw new Error("Not job creator");
    if (job.status !== "open")
      throw new Error("Job not open for awarding");
    if (!job.verified)
      throw new Error("Job not yet funded on-chain");

    const [bid] = await tx
      .select()
      .from(bids)
      .where(eq(bids.id, params.bidId));
    if (!bid) throw new Error("Bid not found");
    if (bid.jobId !== params.jobId) throw new Error("Bid not for this job");
    if (bid.status !== "pending") throw new Error("Bid not pending");

    const amount = bid.amount;
    const parsedAmount = parseFloat(amount);

    if (!job.budgetAmount) {
      throw new Error("Job has no budget set");
    }
    const parsedBudget = parseFloat(job.budgetAmount);

    if (parsedAmount > parsedBudget) {
      throw new Error("Bid amount exceeds job budget");
    }

    // Find existing escrow (created at verify-funding)
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(and(eq(escrows.refId, params.jobId), eq(escrows.refType, "job"), eq(escrows.status, "funded")));
    if (!escrow) {
      throw new Error("Job escrow not found — job may not be funded");
    }

    // Verify worker has a wallet before committing
    const [recipient] = await tx
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, bid.bidderAgentId));
    if (!recipient?.walletAddress) {
      throw new Error("Worker has no wallet address");
    }

    // Accept this bid, reject others
    await tx
      .update(bids)
      .set({ status: "accepted" })
      .where(eq(bids.id, params.bidId));
    await tx
      .update(bids)
      .set({ status: "rejected" })
      .where(and(eq(bids.jobId, params.jobId), eq(bids.status, "pending")));

    // Create assignment (onChainSynced = false until on-chain call succeeds)
    const deadlineAt = new Date(
      Date.now() + (bid.etaSeconds + 86400) * 1000
    );
    const [assignment] = await tx
      .insert(assignments)
      .values({
        jobId: params.jobId,
        workerAgentId: bid.bidderAgentId,
        bidId: params.bidId,
        escrowAmount: amount,
        deadlineAt,
      })
      .returning();

    // Link escrow to assignment and set recipient + amount
    await tx
      .update(escrows)
      .set({
        assignmentId: assignment.id,
        recipientAgentId: bid.bidderAgentId,
        amount,
      })
      .where(eq(escrows.id, escrow.id));

    // Set expiresAt to match assignment deadline (not just 1 hour)
    await tx
      .update(jobs)
      .set({
        status: "in_progress",
        expiresAt: deadlineAt,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, params.jobId));

    return {
      assignment,
      escrowId: escrow.id,
      jobTitle: job.title,
      workerAgentId: bid.bidderAgentId,
      walletAddress: recipient.walletAddress,
      amount,
      parsedAmount,
      parsedBudget,
    };
  });

  // ── On-chain call AFTER transaction — track sync status ──
  let onChainSynced = false;
  if (ESCROW_CONTRACT_ADDRESS && result.walletAddress) {
    try {
      if (result.parsedAmount < result.parsedBudget) {
        await oracleAssignSellerAndAdjust(
          params.jobId,
          result.walletAddress,
          result.amount,
        );
      } else {
        await oracleAssignSeller(params.jobId, result.walletAddress);
      }
      onChainSynced = true;
    } catch (err) {
      console.error(
        `[awardJob] On-chain assignSeller failed for job ${params.jobId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Update sync status
  if (onChainSynced) {
    await db
      .update(assignments)
      .set({ onChainSynced: true })
      .where(eq(assignments.id, result.assignment.id));
  }

  // Post-transaction side effects
  await emitFeedEvent("job_awarded", params.jobId, {
    job_id: params.jobId,
    title: result.jobTitle,
    worker_agent_id: result.workerAgentId,
    amount: result.amount,
  });

  const [updatedEscrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, result.escrowId));

  return {
    assignment: { ...result.assignment, onChainSynced },
    escrow: updatedEscrow,
    on_chain_status: onChainSynced ? "synced" : "pending",
  };
}

export async function submitWork(params: {
  jobId: string;
  workerAgentId: string;
  type: "url" | "file" | "inline";
  deliverableUrl?: string;
  deliverableHash?: string;
  fileId?: string;
  inlineResponse?: string;
}) {
  // Pre-validate file ownership outside transaction (avoids holding lock during file check)
  let resolvedUrl = params.deliverableUrl || null;
  if (params.type === "file" && params.fileId) {
    const [file] = await db
      .select()
      .from(fileUploads)
      .where(eq(fileUploads.id, params.fileId));
    if (!file) throw new Error("File not found");
    if (file.agentId !== params.workerAgentId)
      throw new Error("File does not belong to this agent");
    resolvedUrl = `r2://${file.fileKey}`;
  }

  // ── DB transaction — assignment update + history insert atomic ──
  const result = await withTransaction(async (tx: TX) => {
    const [assignment] = await tx
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.jobId, params.jobId),
          eq(assignments.workerAgentId, params.workerAgentId),
          eq(assignments.status, "in_progress")
        )
      );
    if (!assignment) throw new Error("No active assignment found");

    // Check deadline
    if (assignment.deadlineAt && new Date(assignment.deadlineAt) < new Date()) {
      throw new Error("Assignment deadline has passed");
    }

    // Check revision cap
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, params.jobId));
    if (!job) throw new Error("Job not found");
    if (assignment.revisionCount >= job.maxRevisions) {
      throw new Error(
        `Maximum revisions reached (${job.maxRevisions}). No further submissions allowed.`
      );
    }

    validateAssignmentTransition(assignment.status, "submitted", assignment.id);

    const now = new Date();
    const newRevision = assignment.revisionCount + 1;

    const autoReleaseAt = new Date(
      now.getTime() + job.autoReleaseDays * 24 * 60 * 60 * 1000
    );

    const [updated] = await tx
      .update(assignments)
      .set({
        status: "submitted",
        deliverableType: params.type,
        deliverableUrl: resolvedUrl,
        deliverableHash: params.deliverableHash || null,
        deliverableFileId: params.fileId || null,
        inlineResponse: params.inlineResponse || null,
        revisionCount: newRevision,
        submittedAt: now,
        autoReleaseAt,
      })
      .where(eq(assignments.id, assignment.id))
      .returning();

    // Record in submission history (atomic with assignment update)
    await tx.insert(submissionHistory).values({
      assignmentId: assignment.id,
      submitterAgentId: params.workerAgentId,
      revision: newRevision,
      deliverableType: params.type,
      deliverableUrl: resolvedUrl,
      deliverableHash: params.deliverableHash || null,
      deliverableFileId: params.fileId || null,
      inlineResponse: params.inlineResponse || null,
    });

    return {
      updated,
      assignmentId: assignment.id,
      newRevision,
      creatorAgentId: job.creatorAgentId,
    };
  });

  // ── On-chain markDelivered (best-effort, after transaction) ──
  const delivContent = params.inlineResponse || params.deliverableHash || params.deliverableUrl || params.jobId;
  try {
    const [escrow] = await db
      .select()
      .from(escrows)
      .where(eq(escrows.assignmentId, result.assignmentId));
    if (escrow && escrow.onChainTxHash) {
      const delivHash = hashDeliverable(delivContent!);
      await onChainMarkDelivered(escrow.refId, delivHash);
    }
  } catch (err) {
    console.error("[submitWork] On-chain markDelivered failed:", err instanceof Error ? err.message : err);
  }

  await emitFeedEvent("work_submitted", params.jobId, {
    job_id: params.jobId,
    assignment_id: result.assignmentId,
    worker_agent_id: params.workerAgentId,
    revision: result.newRevision,
    type: params.type,
  });

  return { ...result.updated, creatorAgentId: result.creatorAgentId };
}

export async function acceptWork(params: {
  jobId: string;
  requesterAgentId: string;
}) {
  const result = await withTransaction(async (tx: TX) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, params.jobId));
    if (!job) throw new Error("Job not found");
    if (job.creatorAgentId !== params.requesterAgentId)
      throw new Error("Not job creator");

    const submittedAssignments = await tx
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.jobId, params.jobId),
          eq(assignments.status, "submitted")
        )
      );

    if (submittedAssignments.length === 0)
      throw new Error("No submitted work to accept");

    // Block release if on-chain seller not yet assigned
    for (const a of submittedAssignments) {
      if (!a.onChainSynced) {
        throw new Error(
          `Assignment ${a.id} is not synced on-chain. The seller has not been assigned on the escrow contract yet. Please retry shortly.`
        );
      }
    }

    const workerIds: string[] = [];
    const releasedEscrows: { escrowId: string; workerAgentId: string; amount: string }[] = [];

    for (const assignment of submittedAssignments) {
      validateAssignmentTransition(
        assignment.status,
        "accepted",
        assignment.id
      );

      // Release escrow on-chain
      const [escrow] = await tx
        .select()
        .from(escrows)
        .where(eq(escrows.assignmentId, assignment.id));

      if (escrow) {
        validateEscrowTransition(escrow.status, "released", escrow.id);
        if (!escrow.onChainTxHash) {
          throw new Error("On-chain escrow not yet funded on-chain");
        }
        const releaseTxHash = await onChainRelease(escrow.id);
        await tx
          .update(escrows)
          .set({ status: "released", releasedAt: new Date(), releaseTxHash })
          .where(eq(escrows.id, escrow.id));
        releasedEscrows.push({
          escrowId: escrow.id,
          workerAgentId: assignment.workerAgentId,
          amount: escrow.amount,
        });
      }

      // Update assignment status
      await tx
        .update(assignments)
        .set({ status: "accepted" })
        .where(eq(assignments.id, assignment.id));

      // Update worker reputation
      await tx
        .update(reputation)
        .set({
          completedJobs: sql`${reputation.completedJobs} + 1`,
          totalEarned: sql`(CAST(${reputation.totalEarned} AS DECIMAL) + ${parseFloat(assignment.escrowAmount)})::TEXT`,
          updatedAt: new Date(),
        })
        .where(eq(reputation.agentId, assignment.workerAgentId));

      workerIds.push(assignment.workerAgentId);
    }

    // Check if all assignments accepted → complete job
    const remaining = await tx
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.jobId, params.jobId),
          eq(assignments.status, "in_progress")
        )
      );

    if (remaining.length === 0) {
      validateJobTransition(job.status, "completed", params.jobId);
      await tx
        .update(jobs)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(jobs.id, params.jobId));
    }

    return {
      accepted: submittedAssignments.length,
      workerIds,
      releasedEscrows,
      jobTitle: job.title,
    };
  });

  // Post-tx: buyback-and-burn for agents with tokens (best-effort, non-blocking)
  for (const esc of result.releasedEscrows) {
    tryBuybackForAgent(esc.workerAgentId, esc.amount, esc.escrowId).catch(() => {
      // Buyback is best-effort
    });
  }

  // Post-tx: reputation recalc + on-chain feedback + feed event
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://datalayer-market.fly.dev";
  for (const workerId of result.workerIds) {
    await updateReputation(workerId);
    try {
      const [worker] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, workerId));
      if (worker?.erc8004AgentId) {
        await giveOnChainFeedback({
          agentId: worker.erc8004AgentId,
          value: 100,
          tag1: "job",
          tag2: "completed",
          feedbackURI: `${baseUrl}/api/v1/jobs/${params.jobId}`,
          endpoint: worker.mcpEndpoint || "",
        });
      }
    } catch {
      // On-chain feedback is best-effort
    }
  }

  await emitFeedEvent("job_completed", params.jobId, {
    job_id: params.jobId,
    title: result.jobTitle,
    requester_agent_id: params.requesterAgentId,
  });

  return { accepted: result.accepted };
}

export async function releaseEscrow(escrowId: string) {
  const esc = await withTransaction(async (tx: TX) => {
    const [found] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrowId));
    if (!found || found.status !== "funded") return null;

    validateEscrowTransition(found.status, "released", escrowId);

    if (!found.onChainTxHash) {
      throw new Error("On-chain escrow not yet funded on-chain");
    }
    const releaseTxHash = await onChainRelease(escrowId);
    const [updated] = await tx
      .update(escrows)
      .set({ status: "released", releasedAt: new Date(), releaseTxHash })
      .where(eq(escrows.id, escrowId))
      .returning();
    return updated;
  });

  // Trigger buyback-and-burn for agents with tokens (best-effort)
  if (esc?.recipientAgentId) {
    tryBuybackForAgent(esc.recipientAgentId, esc.amount, esc.id).catch(() => {
      // Buyback is best-effort
    });
  }

  return esc;
}

export async function refundEscrow(escrowId: string) {
  const esc = await withTransaction(async (tx: TX) => {
    const [found] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrowId));
    if (!found || found.status !== "funded") return null;

    validateEscrowTransition(found.status, "refunded", escrowId);

    if (!found.onChainTxHash) {
      throw new Error("On-chain escrow not yet funded on-chain");
    }
    const refundTxHash = await onChainRefund(escrowId);
    const [updated] = await tx
      .update(escrows)
      .set({ status: "refunded", refundedAt: new Date(), releaseTxHash: refundTxHash })
      .where(eq(escrows.id, escrowId))
      .returning();
    return updated;
  });

  return esc;
}

export async function requestChanges(params: {
  jobId: string;
  requesterAgentId: string;
  feedback: string;
}) {
  return withTransaction(async (tx: TX) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, params.jobId));
    if (!job) throw new Error("Job not found");
    if (job.creatorAgentId !== params.requesterAgentId)
      throw new Error("Not job creator");

    const submittedAssignments = await tx
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.jobId, params.jobId),
          eq(assignments.status, "submitted")
        )
      );

    if (submittedAssignments.length === 0) throw new Error("No submitted work");

    for (const assignment of submittedAssignments) {
      // Check revision cap before allowing changes request
      if (assignment.revisionCount >= job.maxRevisions) {
        throw new Error(
          `Maximum revisions reached (${job.maxRevisions}). Accept the work or open a dispute.`
        );
      }

      // Update the latest submission history entry with feedback
      await tx
        .update(submissionHistory)
        .set({ feedback: params.feedback })
        .where(
          and(
            eq(submissionHistory.assignmentId, assignment.id),
            eq(submissionHistory.revision, assignment.revisionCount)
          )
        );

      validateAssignmentTransition(
        assignment.status,
        "in_progress",
        assignment.id
      );
      await tx
        .update(assignments)
        .set({
          status: "in_progress",
          deliverableType: null,
          deliverableUrl: null,
          deliverableHash: null,
          deliverableFileId: null,
          inlineResponse: null,
          submittedAt: null,
          autoReleaseAt: null,
        })
        .where(eq(assignments.id, assignment.id));
    }

    return { resetCount: submittedAssignments.length };
  });
}

/**
 * Get submission history for an assignment (revision tracking).
 */
export async function getSubmissionHistory(assignmentId: string) {
  return db
    .select()
    .from(submissionHistory)
    .where(eq(submissionHistory.assignmentId, assignmentId))
    .orderBy(submissionHistory.revision);
}

/**
 * Get submission history by entity type and ID.
 */
export async function getSubmissionHistoryByEntity(
  entityType: "assignment" | "task" | "gig_order" | "bounty_claim",
  entityId: string
) {
  const column =
    entityType === "assignment"
      ? submissionHistory.assignmentId
      : entityType === "task"
        ? submissionHistory.taskId
        : entityType === "gig_order"
          ? submissionHistory.gigOrderId
          : submissionHistory.bountyClaimId;

  return db
    .select()
    .from(submissionHistory)
    .where(eq(column, entityId))
    .orderBy(submissionHistory.revision);
}

// ============ ON-CHAIN ESCROW FUNCTIONS ============

/**
 * Create an on-chain escrow from the funder's own wallet.
 * Funds are pulled directly from the agent's BSC wallet via approve + transferFrom.
 */
export async function createOnChainEscrow(params: {
  funderAgentId: string;
  recipientAgentId: string;
  amount: string;
  token: SupportedToken;
  refId: string;
  refType: "job" | "task" | "gig_order" | "bounty_claim";
  assignmentId?: string;
  deadlineHours?: number;
  disputeWindowHours?: number;
}) {
  if (!ESCROW_CONTRACT_ADDRESS) {
    throw new Error("On-chain escrow contract not configured");
  }

  // Look up wallet addresses
  const [funder] = await db
    .select({ walletAddress: agents.walletAddress })
    .from(agents)
    .where(eq(agents.id, params.funderAgentId));
  if (!funder?.walletAddress) throw new Error("Funder wallet not found");

  const [recipient] = await db
    .select({ walletAddress: agents.walletAddress })
    .from(agents)
    .where(eq(agents.id, params.recipientAgentId));
  if (!recipient?.walletAddress) throw new Error("Recipient wallet not found");

  // Create DB record first to get the escrow ID
  const [escrow] = await db
    .insert(escrows)
    .values({
      refId: params.refId,
      refType: params.refType,
      assignmentId: params.assignmentId || null,
      funderAgentId: params.funderAgentId,
      recipientAgentId: params.recipientAgentId,
      amount: params.amount,
    })
    .returning();

  try {
    const escrowResult = agentCreateEscrow({
      walletAddress: funder.walletAddress,
      refId: escrow.id,
      sellerAddress: recipient.walletAddress,
      token: params.token,
      amount: params.amount,
      deadlineHours: params.deadlineHours || DEFAULT_DEADLINE_HOURS,
      disputeWindowHours: params.disputeWindowHours || DEFAULT_DISPUTE_WINDOW_HOURS,
    });

    return { ...escrow, unsignedTxs: escrowResult.unsignedTxs };
  } catch (err) {
    await db.delete(escrows).where(eq(escrows.id, escrow.id));
    throw err;
  }
}

/**
 * Mark delivery on-chain for an on-chain escrow.
 */
export async function markOnChainDelivery(
  escrowId: string,
  deliverableContent: string
) {
  const [esc] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, escrowId));
  if (!esc) throw new Error("Escrow not found");
  if (esc.status !== "funded") throw new Error("Escrow not in funded state");

  const delivHash = hashDeliverable(deliverableContent);
  const txHash = await onChainMarkDelivered(esc.refId, delivHash);

  return { txHash, deliverableHash: delivHash };
}

/**
 * Resolve an on-chain dispute with binary or split decision.
 */
export async function resolveOnChainDispute(params: {
  escrowId: string;
  ruling: "requester_wins" | "worker_wins" | "split";
  splitBps?: number;
}) {
  const [esc] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, params.escrowId));
  if (!esc) throw new Error("Escrow not found");
  if (esc.status !== "disputed") throw new Error("Escrow not disputed");

  let txHash: string;

  if (params.ruling === "split" && params.splitBps !== undefined) {
    txHash = await onChainResolveDisputeSplit(esc.refId, params.splitBps);
  } else {
    const releaseToSeller = params.ruling === "worker_wins";
    txHash = await onChainResolveDispute(esc.refId, releaseToSeller);
  }

  const newStatus = params.ruling === "requester_wins" ? "refunded" : "released";
  await db
    .update(escrows)
    .set({
      status: newStatus,
      releaseTxHash: txHash,
      ...(newStatus === "released" ? { releasedAt: new Date() } : { refundedAt: new Date() }),
    })
    .where(eq(escrows.id, params.escrowId));

  return { txHash, status: newStatus };
}
