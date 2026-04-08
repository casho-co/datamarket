import { db, withTransaction, type TX } from "@/lib/db";
import {
  disputes,
  disputeEvidence,
  disputePanelVotes,
  assignments,
  escrows,
  jobs,
  tasks,
  gigOrders,
  reputation,
  agents,
} from "@/lib/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { DISPUTE_DEPOSIT_BPS, RESOLVER_FEE_BPS, DISPUTE_RESOLUTION_DEADLINE_DAYS } from "@/lib/config";
import { checkSufficientBalance } from "./wallet";
import { updateReputation } from "./reputation";
import { emitFeedEvent } from "./feed";
import {
  validateAssignmentTransition,
  validateEscrowTransition,
  validateJobTransition,
  validateTaskTransition,
  validateGigOrderTransition,
} from "./state-machine";
import {
  oracleResolveDispute as onChainResolveDispute,
  oracleResolveDisputeSplit as onChainResolveDisputeSplit,
  getOnChainEscrow,
  OnChainEscrowState,
  buildDisputeData,
} from "@/lib/bsc/escrow-contract";
import { giveOnChainFeedback } from "@/lib/bsc/erc8004";

export async function openDispute(params: {
  jobId: string;
  openerAgentId: string;
  reason: string;
}) {
  // ── Pre-validate: resolve resolver BEFORE transaction ──
  const [job] = await db.select().from(jobs).where(eq(jobs.id, params.jobId));
  if (!job) throw new Error("Job not found");

  let resolverAgentId = job.disputeAgentId || null;
  if (!resolverAgentId) {
    const [aiResolver] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.handle, "datalayer_resolver"));
    if (!aiResolver) {
      throw new Error("No dispute resolver available. Platform resolver not configured.");
    }
    resolverAgentId = aiResolver.id;
  }

  // Pre-validate assignment and balance before transaction
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.jobId, params.jobId),
        eq(assignments.status, "submitted")
      )
    );
  if (!assignment) throw new Error("No submitted assignment to dispute");

  const isCreator = job.creatorAgentId === params.openerAgentId;
  const isWorker = assignment.workerAgentId === params.openerAgentId;
  if (!isCreator && !isWorker)
    throw new Error("Not authorized to dispute");

  const depositAmount = (
    (parseFloat(assignment.escrowAmount) * DISPUTE_DEPOSIT_BPS) /
    10000
  ).toString();

  // On-chain balance check BEFORE transaction
  const hasFunds = await checkSufficientBalance(params.openerAgentId, depositAmount);
  if (!hasFunds) throw new Error("Insufficient on-chain USDC balance for dispute deposit");

  const result = await withTransaction(async (tx: TX) => {
    // Re-validate assignment still submitted
    const [a] = await tx
      .select({ status: assignments.status })
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    if (!a || a.status !== "submitted") throw new Error("Assignment no longer in submitted state");

    // Update assignment status
    validateAssignmentTransition(assignment.status, "disputed", assignment.id);
    await tx
      .update(assignments)
      .set({ status: "disputed" })
      .where(eq(assignments.id, assignment.id));

    // Update escrow status
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.assignmentId, assignment.id));
    if (escrow) {
      validateEscrowTransition(escrow.status, "disputed", escrow.id);
      await tx
        .update(escrows)
        .set({ status: "disputed" })
        .where(eq(escrows.assignmentId, assignment.id));
    }

    // Set voting deadline: 7 days from now
    const resolutionDeadline = new Date(Date.now() + DISPUTE_RESOLUTION_DEADLINE_DAYS * 24 * 60 * 60 * 1000);

    const [dispute] = await tx
      .insert(disputes)
      .values({
        assignmentId: assignment.id,
        openerAgentId: params.openerAgentId,
        resolverAgentId,
        reason: params.reason,
        depositAmount,
        resolutionDeadline,
      })
      .returning();

    // Build unsigned on-chain dispute tx for the buyer to sign
    const unsignedDisputeTx = escrow?.onChainTxHash
      ? buildDisputeData(escrow.refId)
      : null;

    return { dispute, unsignedDisputeTx };
  });

  const dispute = result.dispute;

  // AI resolver runs via cron (ai-dispute-resolve) on the next cycle

  // Post-transaction side effects
  await emitFeedEvent("dispute_opened", params.jobId, {
    job_id: params.jobId,
    dispute_id: dispute.id,
    opener_agent_id: params.openerAgentId,
  });

  return { ...dispute, unsigned_dispute_tx: result.unsignedDisputeTx };
}

export async function addEvidence(params: {
  disputeId: string;
  submitterAgentId: string;
  type: "url" | "photo" | "tracking" | "hash";
  url?: string;
  description?: string;
}) {
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, params.disputeId));
  if (!dispute) throw new Error("Dispute not found");
  if (dispute.ruling !== "pending") throw new Error("Dispute already resolved");

  // Check voting deadline
  if (dispute.resolutionDeadline && new Date() > dispute.resolutionDeadline) {
    throw new Error("Evidence submission deadline has passed");
  }

  // Authorization: only dispute participants can submit evidence
  // (opener, resolver, or the other party in the assignment/task/gig)
  let authorized = false;

  if (dispute.openerAgentId === params.submitterAgentId) authorized = true;
  if (dispute.resolverAgentId === params.submitterAgentId) authorized = true;

  if (!authorized && dispute.assignmentId) {
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, dispute.assignmentId));
    if (assignment) {
      const [job] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, assignment.jobId));
      if (
        assignment.workerAgentId === params.submitterAgentId ||
        job?.creatorAgentId === params.submitterAgentId
      ) {
        authorized = true;
      }
    }
  }

  if (!authorized && dispute.taskId) {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, dispute.taskId));
    if (
      task?.creatorAgentId === params.submitterAgentId ||
      task?.workerAgentId === params.submitterAgentId
    ) {
      authorized = true;
    }
  }

  if (!authorized && dispute.gigOrderId) {
    const [order] = await db
      .select()
      .from(gigOrders)
      .where(eq(gigOrders.id, dispute.gigOrderId));
    if (
      order?.buyerAgentId === params.submitterAgentId ||
      order?.sellerAgentId === params.submitterAgentId
    ) {
      authorized = true;
    }
  }

  if (!authorized) {
    throw new Error("Not authorized to submit evidence for this dispute");
  }

  const [evidence] = await db
    .insert(disputeEvidence)
    .values({
      disputeId: params.disputeId,
      submitterAgentId: params.submitterAgentId,
      type: params.type,
      url: params.url || null,
      description: params.description || null,
    })
    .returning();

  return evidence;
}

export async function resolveDispute(params: {
  disputeId: string;
  resolverAgentId: string;
  ruling: "requester_wins" | "worker_wins" | "split" | "redo";
  splitBps?: number;
}) {
  // ── Pre-validate with reads (no locks) ──
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, params.disputeId));
  if (!dispute) throw new Error("Dispute not found");
  if (dispute.ruling !== "pending") throw new Error("Already resolved");
  if (dispute.resolverAgentId && dispute.resolverAgentId !== params.resolverAgentId) {
    throw new Error("Not authorized to resolve");
  }
  if (!dispute.assignmentId) throw new Error("Assignment not found");

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, dispute.assignmentId));
  if (!assignment) throw new Error("Assignment not found");

  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.assignmentId, assignment.id));
  if (!escrow) throw new Error("Escrow not found");
  if (!escrow.onChainTxHash) throw new Error("On-chain escrow not yet funded on-chain");

  const escrowAmount = parseFloat(escrow.amount);
  const resolverFee = (escrowAmount * RESOLVER_FEE_BPS) / 10000;
  const remainingEscrow = escrowAmount - resolverFee;

  // ── On-chain calls BEFORE transaction (for non-redo rulings) ──
  let releaseTxHash: string | null = null;

  if (params.ruling !== "redo") {
    // Verify on-chain state
    const onChainState = await getOnChainEscrow(escrow.refId);
    const isDisputedOnChain = onChainState.state === OnChainEscrowState.DISPUTED;

    if (!isDisputedOnChain) {
      throw new Error(
        "On-chain escrow is not in disputed state. The buyer must sign the dispute transaction first."
      );
    }

    if (params.ruling === "split") {
      const bps = params.splitBps || 5000;
      releaseTxHash = await onChainResolveDisputeSplit(escrow.refId, bps);
    } else {
      const releaseToSeller = params.ruling === "worker_wins";
      releaseTxHash = await onChainResolveDispute(escrow.refId, releaseToSeller);
    }
  }

  // ── DB transaction — short, no RPC ──
  const result = await withTransaction(async (tx: TX) => {
    // Re-validate dispute is still pending (could have changed)
    const [d] = await tx
      .select()
      .from(disputes)
      .where(eq(disputes.id, params.disputeId));
    if (!d || d.ruling !== "pending") throw new Error("Already resolved");

    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, assignment.jobId));
    if (!job) throw new Error("Job not found");

    if (params.ruling === "redo") {
      validateAssignmentTransition("disputed", "in_progress", assignment.id);
      await tx
        .update(assignments)
        .set({
          status: "in_progress",
          deliverableUrl: null,
          deliverableHash: null,
          submittedAt: null,
        })
        .where(eq(assignments.id, assignment.id));

      validateEscrowTransition("disputed", "funded", escrow.id);
      await tx
        .update(escrows)
        .set({ status: "funded" })
        .where(eq(escrows.assignmentId, assignment.id));
    } else {
      // Update reputation
      if (params.ruling === "requester_wins") {
        await tx
          .update(reputation)
          .set({ disputesLost: sql`${reputation.disputesLost} + 1`, updatedAt: new Date() })
          .where(eq(reputation.agentId, assignment.workerAgentId));
      } else if (params.ruling === "worker_wins") {
        if (d.openerAgentId === job.creatorAgentId) {
          await tx
            .update(reputation)
            .set({ disputesLost: sql`${reputation.disputesLost} + 1`, updatedAt: new Date() })
            .where(eq(reputation.agentId, job.creatorAgentId));
        }
        await tx
          .update(reputation)
          .set({
            completedJobs: sql`${reputation.completedJobs} + 1`,
            totalEarned: sql`(CAST(${reputation.totalEarned} AS DECIMAL) + ${remainingEscrow})::TEXT`,
            updatedAt: new Date(),
          })
          .where(eq(reputation.agentId, assignment.workerAgentId));
      }

      // Update escrow DB status
      const escrowStatus = params.ruling === "requester_wins" ? "refunded" : "released";
      validateEscrowTransition("disputed", escrowStatus, escrow.id);
      await tx
        .update(escrows)
        .set({
          status: escrowStatus as typeof escrow.status,
          releaseTxHash,
          ...(escrowStatus === "released" ? { releasedAt: new Date() } : { refundedAt: new Date() }),
        })
        .where(eq(escrows.assignmentId, assignment.id));

      const newAssignmentStatus = params.ruling === "requester_wins" ? "cancelled" : "accepted";
      validateAssignmentTransition("disputed", newAssignmentStatus, assignment.id);
      await tx
        .update(assignments)
        .set({ status: newAssignmentStatus as typeof assignment.status })
        .where(eq(assignments.id, assignment.id));
    }

    // Update dispute record
    const [resolved] = await tx
      .update(disputes)
      .set({
        ruling: params.ruling,
        splitBps: params.splitBps || null,
        resolvedAt: new Date(),
      })
      .where(eq(disputes.id, params.disputeId))
      .returning();

    // Check if job should be completed
    if (params.ruling !== "redo") {
      const activeAssignments = await tx
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.jobId, job.id),
            eq(assignments.status, "in_progress")
          )
        );
      if (activeAssignments.length === 0) {
        try {
          validateJobTransition(job.status, "completed", job.id);
          await tx
            .update(jobs)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(jobs.id, job.id));
        } catch {
          // Job might not be in a valid state for completion
        }
      }
    }

    return {
      resolved,
      jobId: job.id,
      workerAgentId: assignment.workerAgentId,
    };
  });

  // Post-transaction side effects
  if (
    params.ruling === "requester_wins" ||
    params.ruling === "worker_wins"
  ) {
    await updateReputation(result.workerAgentId);
  }

  // On-chain reputation feedback for dispute outcomes
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://datalayer-market.fly.dev";
  try {
    if (params.ruling === "requester_wins") {
      // Worker lost the dispute — negative feedback
      const [worker] = await db
        .select({ erc8004AgentId: agents.erc8004AgentId })
        .from(agents)
        .where(eq(agents.id, result.workerAgentId));
      if (worker?.erc8004AgentId) {
        await giveOnChainFeedback({
          agentId: worker.erc8004AgentId,
          value: -50,
          tag1: "dispute",
          tag2: "lost",
          feedbackURI: `${baseUrl}/api/v1/disputes/${params.disputeId}`,
        });
      }
    } else if (params.ruling === "worker_wins") {
      // Worker won — positive feedback for delivering despite dispute
      const [worker] = await db
        .select({ erc8004AgentId: agents.erc8004AgentId, mcpEndpoint: agents.mcpEndpoint })
        .from(agents)
        .where(eq(agents.id, result.workerAgentId));
      if (worker?.erc8004AgentId) {
        await giveOnChainFeedback({
          agentId: worker.erc8004AgentId,
          value: 100,
          tag1: "dispute",
          tag2: "won",
          feedbackURI: `${baseUrl}/api/v1/disputes/${params.disputeId}`,
          endpoint: worker.mcpEndpoint || "",
        });
      }
    }
  } catch {
    // On-chain feedback is best-effort
  }

  await emitFeedEvent("dispute_resolved", result.jobId, {
    job_id: result.jobId,
    dispute_id: params.disputeId,
    ruling: params.ruling,
  });

  return result.resolved;
}

// ── Open Task Dispute ──

export async function openTaskDispute(params: {
  taskId: string;
  openerAgentId: string;
  reason: string;
}) {
  const result = await withTransaction(async (tx: TX) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, params.taskId));
    if (!task) throw new Error("Task not found");
    if (task.status !== "submitted") throw new Error("Task not in submitted state");

    const isCreator = task.creatorAgentId === params.openerAgentId;
    const isWorker = task.workerAgentId === params.openerAgentId;
    if (!isCreator && !isWorker) throw new Error("Not authorized to dispute");

    // Calculate deposit from escrow amount
    let depositAmount = "0";
    if (task.escrowId) {
      const [escrow] = await tx.select().from(escrows).where(eq(escrows.id, task.escrowId));
      if (escrow) {
        depositAmount = ((parseFloat(escrow.amount) * DISPUTE_DEPOSIT_BPS) / 10000).toString();
        validateEscrowTransition(escrow.status, "disputed", escrow.id);
        await tx.update(escrows).set({ status: "disputed" }).where(eq(escrows.id, escrow.id));
      }
    }

    // Verify on-chain balance for dispute deposit
    if (parseFloat(depositAmount) > 0) {
      const hasFunds = await checkSufficientBalance(params.openerAgentId, depositAmount);
      if (!hasFunds) throw new Error("Insufficient on-chain USDC balance for dispute deposit");
    }

    // Update task status
    validateTaskTransition(task.status, "disputed", task.id);
    await tx.update(tasks).set({ status: "disputed", updatedAt: new Date() }).where(eq(tasks.id, params.taskId));

    const resolutionDeadline = new Date(Date.now() + DISPUTE_RESOLUTION_DEADLINE_DAYS * 24 * 60 * 60 * 1000);

    const [dispute] = await tx.insert(disputes).values({
      taskId: params.taskId,
      openerAgentId: params.openerAgentId,
      reason: params.reason,
      depositAmount,
      resolutionDeadline,
    }).returning();

    return dispute;
  });

  await emitFeedEvent("dispute_opened", null, {
    task_id: params.taskId,
    dispute_id: result.id,
    opener_agent_id: params.openerAgentId,
  });

  return result;
}

// ── Open Gig Order Dispute ──

export async function openGigOrderDispute(params: {
  gigOrderId: string;
  openerAgentId: string;
  reason: string;
}) {
  const result = await withTransaction(async (tx: TX) => {
    const [order] = await tx.select().from(gigOrders).where(eq(gigOrders.id, params.gigOrderId));
    if (!order) throw new Error("Gig order not found");
    if (order.status !== "delivered") throw new Error("Order not in delivered state");

    const isBuyer = order.buyerAgentId === params.openerAgentId;
    const isSeller = order.sellerAgentId === params.openerAgentId;
    if (!isBuyer && !isSeller) throw new Error("Not authorized to dispute");

    // Calculate deposit from escrow
    let depositAmount = "0";
    if (order.escrowId) {
      const [escrow] = await tx.select().from(escrows).where(eq(escrows.id, order.escrowId));
      if (escrow) {
        depositAmount = ((parseFloat(escrow.amount) * DISPUTE_DEPOSIT_BPS) / 10000).toString();
        validateEscrowTransition(escrow.status, "disputed", escrow.id);
        await tx.update(escrows).set({ status: "disputed" }).where(eq(escrows.id, escrow.id));
      }
    }

    // Verify on-chain balance for dispute deposit
    if (parseFloat(depositAmount) > 0) {
      const hasFunds = await checkSufficientBalance(params.openerAgentId, depositAmount);
      if (!hasFunds) throw new Error("Insufficient on-chain USDC balance for dispute deposit");
    }

    // Update gig order status
    validateGigOrderTransition(order.status, "disputed", order.id);
    await tx.update(gigOrders).set({ status: "disputed" }).where(eq(gigOrders.id, params.gigOrderId));

    const resolutionDeadline = new Date(Date.now() + DISPUTE_RESOLUTION_DEADLINE_DAYS * 24 * 60 * 60 * 1000);

    const [dispute] = await tx.insert(disputes).values({
      gigOrderId: params.gigOrderId,
      openerAgentId: params.openerAgentId,
      reason: params.reason,
      depositAmount,
      resolutionDeadline,
    }).returning();

    return dispute;
  });

  await emitFeedEvent("dispute_opened", null, {
    gig_order_id: params.gigOrderId,
    dispute_id: result.id,
    opener_agent_id: params.openerAgentId,
  });

  return result;
}

export async function getDisputeById(disputeId: string) {
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId));
  if (!dispute) return null;

  const evidence = await db
    .select()
    .from(disputeEvidence)
    .where(eq(disputeEvidence.disputeId, disputeId));

  const panelVotes = await db
    .select()
    .from(disputePanelVotes)
    .where(eq(disputePanelVotes.disputeId, disputeId))
    .orderBy(desc(disputePanelVotes.createdAt));

  return { ...dispute, evidence, panelVotes };
}

// ── Panel Dispute Functions ──

export async function assignPanelResolvers(params: {
  disputeId: string;
  resolverAgentIds: string[];
  assignerAgentId: string;
}) {
  if (params.resolverAgentIds.length < 3) {
    throw new Error("Panel requires at least 3 resolvers");
  }

  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, params.disputeId));
  if (!dispute) throw new Error("Dispute not found");
  if (dispute.ruling !== "pending") throw new Error("Dispute already resolved");

  // Only the current resolver or platform admin can assign panel
  if (
    dispute.resolverAgentId &&
    dispute.resolverAgentId !== params.assignerAgentId
  ) {
    throw new Error("Not authorized to assign panel resolvers");
  }

  // Extend voting deadline for panel: 5 days from now
  const resolutionDeadline = new Date(Date.now() + DISPUTE_RESOLUTION_DEADLINE_DAYS * 24 * 60 * 60 * 1000);

  const [updated] = await db
    .update(disputes)
    .set({
      panelResolvers: params.resolverAgentIds,
      resolutionDeadline,
    })
    .where(eq(disputes.id, params.disputeId))
    .returning();

  return updated;
}

export async function submitPanelVote(params: {
  disputeId: string;
  voterAgentId: string;
  ruling: "requester_wins" | "worker_wins" | "split" | "redo";
  splitBps?: number;
  reason?: string;
}) {
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, params.disputeId));
  if (!dispute) throw new Error("Dispute not found");
  if (dispute.ruling !== "pending") throw new Error("Dispute already resolved");

  // Must be a panel resolver
  if (
    !dispute.panelResolvers ||
    !dispute.panelResolvers.includes(params.voterAgentId)
  ) {
    throw new Error("Not a panel resolver for this dispute");
  }

  // Check voting deadline
  if (dispute.resolutionDeadline && new Date() > dispute.resolutionDeadline) {
    throw new Error("Voting deadline has passed");
  }

  // Insert vote (unique constraint prevents duplicates)
  const [vote] = await db
    .insert(disputePanelVotes)
    .values({
      disputeId: params.disputeId,
      voterAgentId: params.voterAgentId,
      ruling: params.ruling,
      splitBps: params.splitBps || null,
      reason: params.reason || null,
    })
    .returning();

  // Check if majority has voted
  const allVotes = await db
    .select()
    .from(disputePanelVotes)
    .where(eq(disputePanelVotes.disputeId, params.disputeId));

  const totalResolvers = dispute.panelResolvers.length;
  const majorityThreshold = Math.ceil(totalResolvers / 2);

  if (allVotes.length >= majorityThreshold) {
    // Tally votes
    const rulingCounts: Record<string, number> = {};
    for (const v of allVotes) {
      rulingCounts[v.ruling] = (rulingCounts[v.ruling] || 0) + 1;
    }

    // Find majority ruling
    let majorityRuling: string | null = null;
    for (const [ruling, count] of Object.entries(rulingCounts)) {
      if (count >= majorityThreshold) {
        majorityRuling = ruling;
        break;
      }
    }

    if (majorityRuling) {
      // Determine split_bps: average of all split votes if ruling is split
      let avgSplitBps: number | undefined;
      if (majorityRuling === "split") {
        const splitVotes = allVotes.filter(
          (v) => v.ruling === "split" && v.splitBps
        );
        if (splitVotes.length > 0) {
          avgSplitBps = Math.round(
            splitVotes.reduce((sum, v) => sum + (v.splitBps || 5000), 0) /
              splitVotes.length
          );
        }
      }

      // Auto-resolve with majority ruling using any panel resolver as the resolver
      await resolveDispute({
        disputeId: params.disputeId,
        resolverAgentId: params.voterAgentId,
        ruling: majorityRuling as "requester_wins" | "worker_wins" | "split" | "redo",
        splitBps: avgSplitBps,
      });

      return { vote, resolved: true, majority_ruling: majorityRuling };
    }
  }

  return {
    vote,
    resolved: false,
    votes_cast: allVotes.length,
    votes_needed: majorityThreshold,
  };
}

export async function getPanelVotes(disputeId: string) {
  return db
    .select()
    .from(disputePanelVotes)
    .where(eq(disputePanelVotes.disputeId, disputeId))
    .orderBy(desc(disputePanelVotes.createdAt));
}
