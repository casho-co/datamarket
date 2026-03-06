import { db, withTransaction, type TX } from "@/lib/db";
import {
  tasks,
  escrows,
  agents,
  reputation,
  submissionHistory,
  fileUploads,
  tokenLaunches,
} from "@/lib/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { checkSufficientBalance } from "./wallet";
import { validateTaskTransition, validateEscrowTransition } from "./state-machine";
import { emitFeedEvent } from "./feed";
import { updateReputation } from "./reputation";
import { giveOnChainFeedback } from "@/lib/bsc/erc8004";
import {
  agentCreateEscrow,
  oracleRelease as onChainRelease,
  oracleRefund as onChainRefund,
} from "@/lib/bsc/escrow-contract";
import { ESCROW_CONTRACT_ADDRESS, DEFAULT_DEADLINE_HOURS, DEFAULT_DISPUTE_WINDOW_HOURS } from "@/lib/bsc/constants";
import { processPaymentWithBuyback, type BuybackResult } from "@/lib/bsc/buyback";

const DEFAULT_AUTO_RELEASE_DAYS = 7;

/**
 * Look up an agent's launched token address (Four.meme token).
 * Returns the token address if the agent has a successfully launched token, null otherwise.
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
 * If the agent has a launched token, a % of the released payment is used to
 * buy and burn their token via PancakeSwap (LiFi aggregator).
 *
 * This is best-effort — if buyback fails, the payment still goes through.
 */
async function tryBuybackForAgent(
  workerAgentId: string,
  escrowAmount: string,
  escrowId: string
): Promise<BuybackResult | null> {
  try {
    const tokenAddress = await getAgentTokenAddress(workerAgentId);
    if (!tokenAddress) return null; // No token — no buyback

    const result = await processPaymentWithBuyback({
      totalAmount: escrowAmount,
      tokenAddress,
    });

    // Log the buyback result to the escrow record
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
    return null; // Buyback failure is non-fatal
  }
}

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

    // Verify on-chain balance before creating escrow
    const hasFunds = await checkSufficientBalance(params.creatorAgentId, task.quotedAmount);
    if (!hasFunds) throw new Error("Insufficient on-chain USDC balance");

    // Create escrow (on-chain)
    const [escrow] = await tx
      .insert(escrows)
      .values({
        refId: task.id,
        refType: "task",
        funderAgentId: params.creatorAgentId,
        recipientAgentId: task.workerAgentId,
        amount: task.quotedAmount,
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

  // Create on-chain escrow from agent's own wallet
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
        const escrowResult = agentCreateEscrow({
          walletAddress: funder.walletAddress,
          refId: result.escrow.id,
          sellerAddress: recipient.walletAddress,
          token: "USDC",
          amount: result.task.quotedAmount!,
          deadlineHours: DEFAULT_DEADLINE_HOURS,
          disputeWindowHours: DEFAULT_DISPUTE_WINDOW_HOURS,
        });
        return { ...result, unsignedTxs: escrowResult.unsignedTxs };
      } catch {
        await db.delete(escrows).where(eq(escrows.id, result.escrow.id));
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
    let releasedEscrow: { id: string; amount: string } | null = null;
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
        releasedEscrow = { id: escrow.id, amount: escrow.amount };

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

    return { task, releasedEscrow };
  });

  // Post-tx: buyback-and-burn for worker agent's token (best-effort, non-blocking)
  if (result.releasedEscrow) {
    tryBuybackForAgent(
      result.task.workerAgentId,
      result.releasedEscrow.amount,
      result.releasedEscrow.id
    ).catch(() => {
      // Buyback is best-effort — failure does not affect the payment
    });
  }

  // Post-tx side effects
  await updateReputation(result.task.workerAgentId);

  // On-chain reputation feedback for task completion
  try {
    const [worker] = await db
      .select({ erc8004AgentId: agents.erc8004AgentId, mcpEndpoint: agents.mcpEndpoint })
      .from(agents)
      .where(eq(agents.id, result.task.workerAgentId));
    if (worker?.erc8004AgentId) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://datalayer-market.fly.dev";
      await giveOnChainFeedback({
        agentId: worker.erc8004AgentId,
        value: 100,
        tag1: "task",
        tag2: "completed",
        feedbackURI: `${baseUrl}/api/v1/tasks/${params.taskId}`,
        endpoint: worker.mcpEndpoint || "",
      });
    }
  } catch {
    // On-chain feedback is best-effort
  }

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
