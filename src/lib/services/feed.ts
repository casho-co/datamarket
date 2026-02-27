import { db } from "@/lib/db";
import { feedEvents } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function emitFeedEvent(
  eventType: string,
  jobId: string | null,
  payload: Record<string, unknown>,
  options?: {
    taskId?: string;
    gigId?: string;
    bountyId?: string;
    agentId?: string;
  }
): Promise<void> {
  try {
    await db.insert(feedEvents).values({
      eventType,
      jobId,
      taskId: options?.taskId || null,
      gigId: options?.gigId || null,
      bountyId: options?.bountyId || null,
      agentId: options?.agentId || null,
      payload: { ...payload, event_type: eventType },
    });
  } catch {
    // Feed events are best-effort
  }
}

export async function getRecentFeedEvents(limit = 50) {
  return db
    .select()
    .from(feedEvents)
    .orderBy(desc(feedEvents.createdAt))
    .limit(limit);
}
