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
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { updateReputation } from "./reputation";
import { emitFeedEvent } from "./feed";
import { checkSufficientBalance } from "./wallet";
import { giveOnChainFeedback } from "@/lib/bsc/erc8004";
import {
  agentCreateEscrow,
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

export async function awardJob(params: {
  jobId: string;
  bidId: string;
  requesterAgentId: string;
}) {
  const result = await withTransaction(async (tx: TX) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, params.jobId));
    if (!job) throw new Error("Job not found");
    if (job.creatorAgentId !== params.requesterAgentId)
      throw new Error("Not job creator");
    if (!["open", "filling"].includes(job.status))
      throw new Error("Job not open for awarding");

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

    // Verify funder has sufficient on-chain balance for the bid amount
    const hasFunds = await checkSufficientBalance(params.requesterAgentId, amount);
    if (!hasFunds) {
      throw new Error("Insufficient on-chain USDC balance to fund escrow");
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

    // Create assignment
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

    // Create escrow record
    const [escrow] = await tx
      .insert(escrows)
      .values({
        assignmentId: assignment.id,
        funderAgentId: params.requesterAgentId,
        recipientAgentId: bid.bidderAgentId,
        amount,
        escrowType: "on_chain",
      })
      .returning();

    // Update job status with state machine validation
    const existingAssignments = await tx
      .select()
      .from(assignments)
      .where(eq(assignments.jobId, params.jobId));

    const newStatus =
      existingAssignments.length >= job.maxSlots ? "in_progress" : "filling";
    validateJobTransition(job.status, newStatus, params.jobId);

    await tx
      .update(jobs)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(jobs.id, params.jobId));

    return { assignment, escrow, jobTitle: job.title, workerAgentId: bid.bidderAgentId, amount };
  });

  // Create on-chain escrow from agent's own wallet
  if (ESCROW_CONTRACT_ADDRESS) {
    const [funder] = await db
      .select({ walletAddress: agents.walletAddress, walletMode: agents.walletMode })
      .from(agents)
      .where(eq(agents.id, params.requesterAgentId));
    const [recipient] = await db
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, result.escrow.recipientAgentId!));

    if (funder?.walletAddress && recipient?.walletAddress) {
      try {
        const escrowResult = await agentCreateEscrow({
          walletMode: funder.walletMode as "custodial" | "non_custodial",
          walletAddress: funder.walletAddress,
          escrowId: result.escrow.id,
          sellerAddress: recipient.walletAddress,
          token: "USDC",
          amount: result.amount,
          deadlineHours: DEFAULT_DEADLINE_HOURS,
          disputeWindowHours: DEFAULT_DISPUTE_WINDOW_HOURS,
        });

        if (escrowResult.txHash) {
          await db
            .update(escrows)
            .set({ onChainTxHash: escrowResult.txHash })
            .where(eq(escrows.id, result.escrow.id));
          result.escrow = { ...result.escrow, onChainTxHash: escrowResult.txHash };
        }

        // For non-custodial agents, return unsigned tx data
        if (escrowResult.unsignedTx) {
          (result as any).unsignedTx = escrowResult.unsignedTx;
        }
      } catch {
        // Rollback: delete escrow record (no off-chain balance to restore)
        await db.delete(escrows).where(eq(escrows.id, result.escrow.id));
        throw new Error("Failed to create on-chain escrow");
      }
    }
  }

  // Post-transaction side effects (non-critical)
  await emitFeedEvent("job_awarded", params.jobId, {
    job_id: params.jobId,
    title: result.jobTitle,
    worker_agent_id: result.workerAgentId,
    amount: result.amount,
  });

  return { assignment: result.assignment, escrow: result.escrow, unsignedTx: (result as any).unsignedTx };
}

export async function submitWork(params: {
  jobId: string;
  workerAgentId: string;
  type: "url" | "file" | "inline" | "hash_only";
  deliverableUrl?: string;
  deliverableHash?: string;
  fileId?: string;
  inlineResponse?: string;
}) {
  const [assignment] = await db
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

  // Check revision cap
  const [job] = await db.select().from(jobs).where(eq(jobs.id, params.jobId));
  if (!job) throw new Error("Job not found");
  if (assignment.revisionCount >= job.maxRevisions) {
    throw new Error(
      `Maximum revisions reached (${job.maxRevisions}). No further submissions allowed.`
    );
  }

  // If file type, verify the file belongs to this agent
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

  validateAssignmentTransition(assignment.status, "submitted", assignment.id);

  const now = new Date();
  const newRevision = assignment.revisionCount + 1;

  // Calculate auto-release deadline
  const autoReleaseAt = new Date(
    now.getTime() + job.autoReleaseDays * 24 * 60 * 60 * 1000
  );

  const [updated] = await db
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

  // Record in submission history
  await db.insert(submissionHistory).values({
    assignmentId: assignment.id,
    submitterAgentId: params.workerAgentId,
    revision: newRevision,
    deliverableType: params.type,
    deliverableUrl: resolvedUrl,
    deliverableHash: params.deliverableHash || null,
    deliverableFileId: params.fileId || null,
    inlineResponse: params.inlineResponse || null,
  });

  await emitFeedEvent("work_submitted", params.jobId, {
    job_id: params.jobId,
    assignment_id: assignment.id,
    worker_agent_id: params.workerAgentId,
    revision: newRevision,
    type: params.type,
  });

  return updated;
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

    const workerIds: string[] = [];

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
      jobTitle: job.title,
    };
  });

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
  assignmentId?: string;
  taskId?: string;
  gigOrderId?: string;
  bountyClaimId?: string;
  deadlineHours?: number;
  disputeWindowHours?: number;
}) {
  if (!ESCROW_CONTRACT_ADDRESS) {
    throw new Error("On-chain escrow contract not configured");
  }

  // Look up wallet addresses and mode
  const [funder] = await db
    .select({ walletAddress: agents.walletAddress, walletMode: agents.walletMode })
    .from(agents)
    .where(eq(agents.id, params.funderAgentId));
  if (!funder?.walletAddress) throw new Error("Funder wallet not found");

  const [recipient] = await db
    .select({ walletAddress: agents.walletAddress })
    .from(agents)
    .where(eq(agents.id, params.recipientAgentId));
  if (!recipient?.walletAddress) throw new Error("Recipient wallet not found");

  // Verify on-chain balance
  const hasFunds = await checkSufficientBalance(params.funderAgentId, params.amount);
  if (!hasFunds) {
    throw new Error("Insufficient on-chain USDC balance");
  }

  // Create DB record first to get the escrow ID
  const [escrow] = await db
    .insert(escrows)
    .values({
      assignmentId: params.assignmentId || null,
      taskId: params.taskId || null,
      gigOrderId: params.gigOrderId || null,
      bountyClaimId: params.bountyClaimId || null,
      funderAgentId: params.funderAgentId,
      recipientAgentId: params.recipientAgentId,
      amount: params.amount,
      escrowType: "on_chain",
    })
    .returning();

  try {
    // Create on-chain escrow from agent's own wallet
    const escrowResult = await agentCreateEscrow({
      walletMode: funder.walletMode as "custodial" | "non_custodial",
      walletAddress: funder.walletAddress,
      escrowId: escrow.id,
      sellerAddress: recipient.walletAddress,
      token: params.token,
      amount: params.amount,
      deadlineHours: params.deadlineHours || DEFAULT_DEADLINE_HOURS,
      disputeWindowHours: params.disputeWindowHours || DEFAULT_DISPUTE_WINDOW_HOURS,
    });

    if (escrowResult.txHash) {
      await db
        .update(escrows)
        .set({ onChainTxHash: escrowResult.txHash })
        .where(eq(escrows.id, escrow.id));
      return { ...escrow, onChainTxHash: escrowResult.txHash };
    }

    // Non-custodial: return unsigned tx data for agent to sign
    return { ...escrow, unsignedTx: escrowResult.unsignedTx };
  } catch (err) {
    // Rollback: delete DB record (no off-chain balance to restore)
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
  if (esc.escrowType !== "on_chain") throw new Error("Not an on-chain escrow");
  if (esc.status !== "funded") throw new Error("Escrow not in funded state");

  const delivHash = hashDeliverable(deliverableContent);
  const txHash = await onChainMarkDelivered(escrowId, delivHash);

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
  if (esc.escrowType !== "on_chain") throw new Error("Not an on-chain escrow");
  if (esc.status !== "disputed") throw new Error("Escrow not disputed");

  let txHash: string;

  if (params.ruling === "split" && params.splitBps !== undefined) {
    txHash = await onChainResolveDisputeSplit(params.escrowId, params.splitBps);
  } else {
    const releaseToSeller = params.ruling === "worker_wins";
    txHash = await onChainResolveDispute(params.escrowId, releaseToSeller);
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
