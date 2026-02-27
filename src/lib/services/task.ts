import { db, withTransaction, type TX } from "@/lib/db";
import {
  tasks,
  escrows,
  agentWallets,
  agents,
  reputation,
  submissionHistory,
  fileUploads,
} from "@/lib/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { validateTaskTransition, validateEscrowTransition } from "./state-machine";
import { emitFeedEvent } from "./feed";
import { updateReputation } from "./reputation";
import {
  oracleCreateEscrow,
  oracleRelease as onChainRelease,
  oracleRefund as onChainRefund,
} from "@/lib/bsc/escrow-contract";
import { ESCROW_CONTRACT_ADDRESS, DEFAULT_DEADLINE_HOURS, DEFAULT_DISPUTE_WINDOW_HOURS } from "@/lib/bsc/constants";

const DEFAULT_AUTO_RELEASE_DAYS = 7;

// ── Create Task (Quote Request) ──

export async function createTask(params: {
  creatorAgentId: string;
  workerAgentId: string;
  title: string;
  description: string;
  tags?: string[];
}) {
  if (params.creatorAgentId === params.workerAgentId) {
    throw new Error("Cannot create task for yourself");
  }

  const [task] = await db
    .insert(tasks)
    .values({
      creatorAgentId: params.creatorAgentId,
      workerAgentId: params.workerAgentId,
      title: params.title,
      description: params.description,
      tags: params.tags || [],
    })
    .returning();

  await emitFeedEvent("task_created", null, {
    task_id: task.id,
    title: task.title,
    creator_agent_id: params.creatorAgentId,
    worker_agent_id: params.workerAgentId,
  });

  return task;
}

// ── Submit Quote ──

export async function submitQuote(params: {
  taskId: string;
  workerAgentId: string;
  amount: string;
  etaSeconds: number;
  message?: string;
}) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, params.taskId));

  if (!task) throw new Error("Task not found");
  if (task.workerAgentId !== params.workerAgentId)
    throw new Error("Not the assigned agent");

  validateTaskTransition(task.status, "quoted", task.id);

  const [updated] = await db
    .update(tasks)
    .set({
      status: "quoted",
      quotedAmount: params.amount,
      quotedEtaSeconds: params.etaSeconds,
      quotedMessage: params.message || null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, params.taskId))
    .returning();

  return updated;
}

// ── Accept Quote (locks escrow) ──

export async function acceptQuote(params: {
  taskId: string;
  creatorAgentId: string;
}) {
  const result = await withTransaction(async (tx: TX) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, params.taskId));

    if (!task) throw new Error("Task not found");
    if (task.creatorAgentId !== params.creatorAgentId)
      throw new Error("Not task creator");
    if (!task.quotedAmount) throw new Error("No quote submitted");

    validateTaskTransition(task.status, "accepted", task.id);

    const amount = parseFloat(task.quotedAmount);

    // Debit creator
    const [debitResult] = await tx
      .update(agentWallets)
      .set({
        balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) - ${amount})::TEXT`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentWallets.agentId, params.creatorAgentId),
          sql`CAST(${agentWallets.balance} AS DECIMAL) >= ${amount}`
        )
      )
      .returning({ agentId: agentWallets.agentId });

    if (!debitResult) throw new Error("Insufficient balance");

    // Create escrow (on-chain)
    const [escrow] = await tx
      .insert(escrows)
      .values({
        taskId: task.id,
        funderAgentId: params.creatorAgentId,
        recipientAgentId: task.workerAgentId,
        amount: task.quotedAmount,
        escrowType: "on_chain",
      })
      .returning();

    // Set deadline
    const deadlineAt = task.quotedEtaSeconds
      ? new Date(Date.now() + (task.quotedEtaSeconds + 86400) * 1000)
      : null;

    await tx
      .update(tasks)
      .set({
        status: "accepted",
        escrowId: escrow.id,
        deadlineAt,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, params.taskId));

    return { task, escrow };
  });

  // Lock funds on-chain via smart contract
  if (ESCROW_CONTRACT_ADDRESS && result.escrow) {
    const [funder] = await db
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, params.creatorAgentId));
    const [recipient] = await db
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, result.task.workerAgentId));

    if (funder?.walletAddress && recipient?.walletAddress) {
      try {
        const txHash = await oracleCreateEscrow({
          escrowId: result.escrow.id,
          buyerAddress: funder.walletAddress,
          sellerAddress: recipient.walletAddress,
          token: "USDC",
          amount: result.task.quotedAmount!,
          deadlineHours: DEFAULT_DEADLINE_HOURS,
          disputeWindowHours: DEFAULT_DISPUTE_WINDOW_HOURS,
        });
        await db
          .update(escrows)
          .set({ onChainTxHash: txHash })
          .where(eq(escrows.id, result.escrow.id));
      } catch {
        // Rollback: delete escrow and re-credit balance
        await db.delete(escrows).where(eq(escrows.id, result.escrow.id));
        await db
          .update(agentWallets)
          .set({
            balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) + ${parseFloat(result.task.quotedAmount!)})::TEXT`,
            updatedAt: new Date(),
          })
          .where(eq(agentWallets.agentId, params.creatorAgentId));
        throw new Error("Failed to create on-chain escrow");
      }
    }
  }

  return result;
}

// ── Reject Quote ──

export async function rejectQuote(params: {
  taskId: string;
  creatorAgentId: string;
}) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, params.taskId));

  if (!task) throw new Error("Task not found");
  if (task.creatorAgentId !== params.creatorAgentId)
    throw new Error("Not task creator");

  validateTaskTransition(task.status, "rejected", task.id);

  const [updated] = await db
    .update(tasks)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(tasks.id, params.taskId))
    .returning();

  return updated;
}

// ── Submit Task Deliverable ──

export async function submitTaskWork(params: {
  taskId: string;
  workerAgentId: string;
  type: "url" | "file" | "inline" | "hash_only";
  deliverableUrl?: string;
  deliverableHash?: string;
  fileId?: string;
  inlineResponse?: string;
}) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, params.taskId));

  if (!task) throw new Error("Task not found");
  if (task.workerAgentId !== params.workerAgentId)
    throw new Error("Not the assigned agent");

  // Check revision cap
  if (task.revisionCount >= task.maxRevisions) {
    throw new Error(
      `Maximum revisions reached (${task.maxRevisions}). No further submissions allowed.`
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

  // Allow submission from accepted or in_progress
  const fromStatus =
    task.status === "accepted" ? "accepted" : task.status;
  if (fromStatus === "accepted") {
    validateTaskTransition("accepted", "in_progress", task.id);
  }
  validateTaskTransition(
    task.status === "accepted" ? "in_progress" : task.status,
    "submitted",
    task.id
  );

  const now = new Date();
  const newRevision = task.revisionCount + 1;
  const autoReleaseAt = new Date(
    now.getTime() + DEFAULT_AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000
  );

  const [updated] = await db
    .update(tasks)
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
      updatedAt: now,
    })
    .where(eq(tasks.id, params.taskId))
    .returning();

  // Record in submission history
  await db.insert(submissionHistory).values({
    taskId: params.taskId,
    submitterAgentId: params.workerAgentId,
    revision: newRevision,
    deliverableType: params.type,
    deliverableUrl: resolvedUrl,
    deliverableHash: params.deliverableHash || null,
    deliverableFileId: params.fileId || null,
    inlineResponse: params.inlineResponse || null,
  });

  return updated;
}

// ── Complete Task (accept work, release escrow) ──

export async function completeTask(params: {
  taskId: string;
  creatorAgentId: string;
}) {
  const result = await withTransaction(async (tx: TX) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, params.taskId));

    if (!task) throw new Error("Task not found");
    if (task.creatorAgentId !== params.creatorAgentId)
      throw new Error("Not task creator");

    validateTaskTransition(task.status, "completed", task.id);

    // Release escrow on-chain
    if (task.escrowId) {
      const [escrow] = await tx
        .select()
        .from(escrows)
        .where(eq(escrows.id, task.escrowId));

      if (escrow && escrow.status === "funded") {
        if (!escrow.onChainTxHash) {
          throw new Error("On-chain escrow not yet funded on-chain");
        }
        validateEscrowTransition(escrow.status, "released", escrow.id);
        const releaseTxHash = await onChainRelease(escrow.id);
        await tx
          .update(escrows)
          .set({ status: "released", releasedAt: new Date(), releaseTxHash })
          .where(eq(escrows.id, escrow.id));

        // Update reputation counters
        await tx
          .update(reputation)
          .set({
            completedJobs: sql`${reputation.completedJobs} + 1`,
            totalEarned: sql`(CAST(${reputation.totalEarned} AS DECIMAL) + ${parseFloat(escrow.amount)})::TEXT`,
            updatedAt: new Date(),
          })
          .where(eq(reputation.agentId, task.workerAgentId));
      }
    }

    await tx
      .update(tasks)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(tasks.id, params.taskId));

    return { task };
  });

  // Post-tx side effects
  await updateReputation(result.task.workerAgentId);
  await emitFeedEvent("task_completed", null, {
    task_id: params.taskId,
    title: result.task.title,
  });

  return { success: true };
}

// ── Request Changes ──

export async function requestTaskChanges(params: {
  taskId: string;
  creatorAgentId: string;
  feedback: string;
}) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, params.taskId));

  if (!task) throw new Error("Task not found");
  if (task.creatorAgentId !== params.creatorAgentId)
    throw new Error("Not task creator");

  validateTaskTransition(task.status, "in_progress", task.id);

  // Check revision cap
  if (task.revisionCount >= task.maxRevisions) {
    throw new Error(
      `Maximum revisions reached (${task.maxRevisions}). Accept the work or open a dispute.`
    );
  }

  // Record feedback on the latest submission history entry
  await db
    .update(submissionHistory)
    .set({ feedback: params.feedback })
    .where(
      and(
        eq(submissionHistory.taskId, params.taskId),
        eq(submissionHistory.revision, task.revisionCount)
      )
    );

  const [updated] = await db
    .update(tasks)
    .set({
      status: "in_progress",
      deliverableType: null,
      deliverableUrl: null,
      deliverableHash: null,
      deliverableFileId: null,
      inlineResponse: null,
      submittedAt: null,
      autoReleaseAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, params.taskId))
    .returning();

  return updated;
}

// ── Cancel Task ──

export async function cancelTask(params: {
  taskId: string;
  agentId: string;
}) {
  return withTransaction(async (tx: TX) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, params.taskId));

    if (!task) throw new Error("Task not found");

    // Only creator can cancel
    if (task.creatorAgentId !== params.agentId)
      throw new Error("Not task creator");

    validateTaskTransition(task.status, "cancelled", task.id);

    // Refund escrow on-chain
    if (task.escrowId) {
      const [escrow] = await tx
        .select()
        .from(escrows)
        .where(eq(escrows.id, task.escrowId));

      if (escrow && escrow.status === "funded") {
        if (!escrow.onChainTxHash) {
          throw new Error("On-chain escrow not yet funded on-chain");
        }
        validateEscrowTransition(escrow.status, "refunded", escrow.id);
        const refundTxHash = await onChainRefund(escrow.id);
        await tx
          .update(escrows)
          .set({ status: "refunded", refundedAt: new Date(), releaseTxHash: refundTxHash })
          .where(eq(escrows.id, escrow.id));
      }
    }

    const [updated] = await tx
      .update(tasks)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(tasks.id, params.taskId))
      .returning();

    return updated;
  });
}

// ── List Tasks ──

export async function getTaskById(taskId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId));
  return task || null;
}

export async function listTasksForAgent(
  agentId: string,
  role: "creator" | "worker",
  limit = 20,
  offset = 0
) {
  const condition =
    role === "creator"
      ? eq(tasks.creatorAgentId, agentId)
      : eq(tasks.workerAgentId, agentId);

  return db
    .select()
    .from(tasks)
    .where(condition)
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .offset(offset);
}
