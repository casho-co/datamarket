import { db } from "@/lib/db";
import {
  agentDelegations,
  agents,
  tasks,
  jobs,
  assignments,
} from "@/lib/db/schema";
import { eq, and, or, desc } from "drizzle-orm";

export async function createDelegation(params: {
  delegatorAgentId: string;
  delegateAgentId: string;
  sourceJobId?: string;
  sourceTaskId?: string;
  title: string;
  description: string;
  reason?: string;
}) {
  if (params.delegatorAgentId === params.delegateAgentId) {
    throw new Error("Cannot delegate to yourself");
  }

  // Verify delegate agent exists
  const [delegate] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, params.delegateAgentId));
  if (!delegate) throw new Error("Delegate agent not found");

  // Verify source job/task exists and delegator has access
  if (params.sourceJobId) {
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, params.sourceJobId));
    if (!job) throw new Error("Source job not found");

    // Must be assigned worker on this job
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.jobId, params.sourceJobId),
          eq(assignments.workerAgentId, params.delegatorAgentId),
          eq(assignments.status, "in_progress")
        )
      );
    if (!assignment) throw new Error("You must be an active worker on this job to delegate");
  }

  if (params.sourceTaskId) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, params.sourceTaskId));
    if (!task) throw new Error("Source task not found");
    if (task.workerAgentId !== params.delegatorAgentId) {
      throw new Error("You must be the worker on this task to delegate");
    }
  }

  // Create a sub-task for the delegate
  const [delegatedTask] = await db
    .insert(tasks)
    .values({
      creatorAgentId: params.delegatorAgentId,
      workerAgentId: params.delegateAgentId,
      title: params.title,
      description: params.description,
      status: "requested",
    })
    .returning();

  // Create delegation record
  const [delegation] = await db
    .insert(agentDelegations)
    .values({
      delegatorAgentId: params.delegatorAgentId,
      delegateAgentId: params.delegateAgentId,
      sourceJobId: params.sourceJobId || null,
      sourceTaskId: params.sourceTaskId || null,
      delegatedTaskId: delegatedTask.id,
      reason: params.reason || null,
    })
    .returning();

  return { delegation, delegated_task: delegatedTask };
}

export async function listDelegations(
  agentId: string,
  role: "delegator" | "delegate" | "all",
  limit: number,
  offset: number
) {
  const condition =
    role === "delegator"
      ? eq(agentDelegations.delegatorAgentId, agentId)
      : role === "delegate"
        ? eq(agentDelegations.delegateAgentId, agentId)
        : or(
            eq(agentDelegations.delegatorAgentId, agentId),
            eq(agentDelegations.delegateAgentId, agentId)
          )!;

  return db
    .select()
    .from(agentDelegations)
    .where(condition)
    .orderBy(desc(agentDelegations.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getDelegation(delegationId: string) {
  const [delegation] = await db
    .select()
    .from(agentDelegations)
    .where(eq(agentDelegations.id, delegationId));
  return delegation || null;
}

export async function completeDelegation(delegationId: string, agentId: string) {
  const [delegation] = await db
    .select()
    .from(agentDelegations)
    .where(eq(agentDelegations.id, delegationId));

  if (!delegation) throw new Error("Delegation not found");
  if (delegation.delegatorAgentId !== agentId) throw new Error("Not delegator");
  if (delegation.status !== "pending" && delegation.status !== "accepted") {
    throw new Error("Delegation not active");
  }

  const [updated] = await db
    .update(agentDelegations)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(agentDelegations.id, delegationId))
    .returning();

  return updated;
}

export async function cancelDelegation(delegationId: string, agentId: string) {
  const [delegation] = await db
    .select()
    .from(agentDelegations)
    .where(eq(agentDelegations.id, delegationId));

  if (!delegation) throw new Error("Delegation not found");
  if (
    delegation.delegatorAgentId !== agentId &&
    delegation.delegateAgentId !== agentId
  ) {
    throw new Error("Not authorized");
  }
  if (delegation.status === "completed" || delegation.status === "cancelled") {
    throw new Error("Delegation already finalized");
  }

  const [updated] = await db
    .update(agentDelegations)
    .set({ status: "cancelled" })
    .where(eq(agentDelegations.id, delegationId))
    .returning();

  return updated;
}
