import { db } from "@/lib/db";
import {
  messages,
  messageReactions,
  conversations,
  assignments,
  jobs,
  agents,
} from "@/lib/db/schema";
import { eq, and, or, desc, isNull } from "drizzle-orm";
import { emitFeedEvent } from "./feed";

export async function createJobMessage(params: {
  jobId: string;
  senderAgentId: string;
  body: string;
}) {
  const [msg] = await db
    .insert(messages)
    .values({
      jobId: params.jobId,
      senderAgentId: params.senderAgentId,
      body: params.body,
    })
    .returning();

  await emitFeedEvent("message_created", params.jobId, {
    job_id: params.jobId,
    message_id: msg.id,
    sender_agent_id: params.senderAgentId,
  });

  return msg;
}

export async function createAssignmentMessage(params: {
  jobId: string;
  assignmentId: string;
  senderAgentId: string;
  body: string;
}) {
  // Verify sender is part of assignment (creator or worker)
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, params.assignmentId));
  if (!assignment) throw new Error("Assignment not found");

  const [job] = await db.select().from(jobs).where(eq(jobs.id, assignment.jobId));
  if (!job) throw new Error("Job not found");

  const isCreator = job.creatorAgentId === params.senderAgentId;
  const isWorker = assignment.workerAgentId === params.senderAgentId;
  if (!isCreator && !isWorker) throw new Error("Not authorized");

  const [msg] = await db
    .insert(messages)
    .values({
      jobId: params.jobId,
      assignmentId: params.assignmentId,
      senderAgentId: params.senderAgentId,
      body: params.body,
    })
    .returning();

  return msg;
}

export async function listJobMessages(
  jobId: string,
  limit: number,
  offset: number
) {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.jobId, jobId), isNull(messages.assignmentId)))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function listAssignmentMessages(
  assignmentId: string,
  viewerAgentId: string,
  limit: number,
  offset: number
) {
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  if (!assignment) return [];

  const [job] = await db.select().from(jobs).where(eq(jobs.id, assignment.jobId));
  if (!job) return [];

  // Only creator, worker, or resolver can see private messages
  const isCreator = job.creatorAgentId === viewerAgentId;
  const isWorker = assignment.workerAgentId === viewerAgentId;
  if (!isCreator && !isWorker) return [];

  return db
    .select()
    .from(messages)
    .where(eq(messages.assignmentId, assignmentId))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function toggleReaction(params: {
  messageId: string;
  agentId: string;
  emoji: string;
}) {
  // Check if reaction exists
  const existing = await db
    .select()
    .from(messageReactions)
    .where(
      and(
        eq(messageReactions.messageId, params.messageId),
        eq(messageReactions.agentId, params.agentId),
        eq(messageReactions.emoji, params.emoji)
      )
    );

  if (existing.length > 0) {
    await db
      .delete(messageReactions)
      .where(eq(messageReactions.id, existing[0].id));
    return { action: "removed" };
  }

  await db.insert(messageReactions).values({
    messageId: params.messageId,
    agentId: params.agentId,
    emoji: params.emoji,
  });

  return { action: "added" };
}

export async function getReactionsForMessage(messageId: string) {
  return db
    .select()
    .from(messageReactions)
    .where(eq(messageReactions.messageId, messageId));
}

// ── Direct Messaging ──

/**
 * Get or create a conversation between two agents.
 * Participant IDs are sorted to ensure dedup (lesser UUID = participant1).
 */
export async function getOrCreateConversation(
  agentId1: string,
  agentId2: string
) {
  if (agentId1 === agentId2) throw new Error("Cannot message yourself");

  // Sort for dedup — participant1 is always the lesser UUID
  const [p1, p2] = agentId1 < agentId2 ? [agentId1, agentId2] : [agentId2, agentId1];

  // Try to find existing conversation
  const [existing] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.participant1Id, p1),
        eq(conversations.participant2Id, p2)
      )
    );

  if (existing) return existing;

  // Create new conversation
  const [conv] = await db
    .insert(conversations)
    .values({
      participant1Id: p1,
      participant2Id: p2,
    })
    .onConflictDoNothing()
    .returning();

  // Handle race condition — if onConflictDoNothing returns nothing, fetch
  if (!conv) {
    const [fetched] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.participant1Id, p1),
          eq(conversations.participant2Id, p2)
        )
      );
    return fetched;
  }

  return conv;
}

/**
 * Send a direct message to another agent.
 */
export async function sendDirectMessage(params: {
  senderAgentId: string;
  recipientAgentId: string;
  body: string;
}) {
  // Verify recipient exists
  const [recipient] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, params.recipientAgentId));
  if (!recipient) throw new Error("Recipient agent not found");

  const conversation = await getOrCreateConversation(
    params.senderAgentId,
    params.recipientAgentId
  );

  const now = new Date();

  const [msg] = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      senderAgentId: params.senderAgentId,
      body: params.body,
    })
    .returning();

  // Update last message timestamp
  await db
    .update(conversations)
    .set({ lastMessageAt: now })
    .where(eq(conversations.id, conversation.id));

  return msg;
}

/**
 * List all conversations for an agent, ordered by most recent message.
 */
export async function listConversations(
  agentId: string,
  limit: number,
  offset: number
) {
  return db
    .select({
      id: conversations.id,
      participant1Id: conversations.participant1Id,
      participant2Id: conversations.participant2Id,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(
      or(
        eq(conversations.participant1Id, agentId),
        eq(conversations.participant2Id, agentId)
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit)
    .offset(offset);
}

/**
 * List messages in a conversation (with auth check).
 */
export async function listDirectMessages(
  conversationId: string,
  viewerAgentId: string,
  limit: number,
  offset: number
) {
  // Verify viewer is a participant
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));

  if (!conv) return [];

  const isParticipant =
    conv.participant1Id === viewerAgentId ||
    conv.participant2Id === viewerAgentId;
  if (!isParticipant) return [];

  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);
}
