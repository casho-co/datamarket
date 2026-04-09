import { createHmac } from "crypto";
import { db } from "@/lib/db";
import { webhookDeliveries, agents } from "@/lib/db/schema";
import { eq, and, sql, lte } from "drizzle-orm";
import { CRON_BATCH_LIMIT } from "@/lib/config";

// ── Retry Configuration ──

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE = 4; // exponential: 1s, 4s, 16s, 64s, 256s
const DELIVERY_TIMEOUT_MS = 5000;

// ── Event Types ──

export type WebhookEventType =
  | "agent.registered"
  | "job.created"
  | "job.awarded"
  | "job.completed"
  | "job.cancelled"
  | "bid.received"
  | "bid.accepted"
  | "bid.rejected"
  | "work.submitted"
  | "work.accepted"
  | "work.changes_requested"
  | "work.disputed"
  | "task.quote_requested"
  | "task.quote_received"
  | "gig.order_placed"
  | "gig.order_cancelled"
  | "bounty.claimed";

// ── Deliver Webhook ──

export const ALL_WEBHOOK_EVENTS: WebhookEventType[] = [
  "agent.registered",
  "job.created",
  "job.awarded",
  "job.completed",
  "job.cancelled",
  "bid.received",
  "bid.accepted",
  "bid.rejected",
  "work.submitted",
  "work.accepted",
  "work.changes_requested",
  "work.disputed",
  "task.quote_requested",
  "task.quote_received",
  "gig.order_placed",
  "gig.order_cancelled",
  "bounty.claimed",
];

export async function deliverWebhook(
  agentId: string,
  event: WebhookEventType,
  payload: Record<string, unknown>
): Promise<void> {
  const [agent] = await db
    .select({
      webhookUrl: agents.webhookUrl,
      webhookEvents: agents.webhookEvents,
    })
    .from(agents)
    .where(eq(agents.id, agentId));

  if (!agent?.webhookUrl) return;

  // Check event filtering: if webhookEvents is set, only deliver subscribed events
  if (agent.webhookEvents && agent.webhookEvents.length > 0) {
    if (!agent.webhookEvents.includes(event)) return;
  }

  // Create delivery record
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      agentId,
      webhookUrl: agent.webhookUrl,
      eventType: event,
      payload: { event, payload, timestamp: Date.now() },
      attempt: 0,
      maxAttempts: MAX_ATTEMPTS,
      status: "pending",
    })
    .returning();

  // Attempt first delivery immediately
  await attemptDelivery(delivery.id);
}

async function attemptDelivery(deliveryId: string): Promise<void> {
  const [delivery] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId));

  if (!delivery || delivery.status === "delivered") return;

  const body = JSON.stringify(delivery.payload);
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[webhook] WEBHOOK_SECRET not set — skipping delivery", deliveryId);
    return;
  }
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const newAttempt = delivery.attempt + 1;

  try {
    const response = await fetch(delivery.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": delivery.eventType,
        "X-Webhook-Delivery-Id": delivery.id,
        "X-Webhook-Attempt": String(newAttempt),
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (response.ok) {
      await db
        .update(webhookDeliveries)
        .set({
          status: "delivered",
          statusCode: response.status,
          attempt: newAttempt,
          deliveredAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, deliveryId));
      return;
    }

    await scheduleRetry(deliveryId, newAttempt, response.status, null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await scheduleRetry(deliveryId, newAttempt, null, message);
  }
}

async function scheduleRetry(
  deliveryId: string,
  attempt: number,
  statusCode: number | null,
  errorMessage: string | null
): Promise<void> {
  if (attempt >= MAX_ATTEMPTS) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "failed",
        statusCode,
        attempt,
        errorMessage:
          errorMessage || `Failed after ${MAX_ATTEMPTS} attempts`,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return;
  }

  const delaySec = Math.pow(BACKOFF_BASE, attempt - 1);
  const nextRetryAt = new Date(Date.now() + delaySec * 1000);

  await db
    .update(webhookDeliveries)
    .set({ attempt, statusCode, errorMessage, nextRetryAt })
    .where(eq(webhookDeliveries.id, deliveryId));
}

// ── Process Pending Retries (called by cron) ──

export async function processWebhookRetries(): Promise<number> {
  const pendingDeliveries = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        lte(webhookDeliveries.nextRetryAt, new Date()),
        sql`${webhookDeliveries.attempt} < ${webhookDeliveries.maxAttempts}`
      )
    )
    .limit(CRON_BATCH_LIMIT);

  for (const delivery of pendingDeliveries) {
    await attemptDelivery(delivery.id);
  }

  return pendingDeliveries.length;
}

// ── Query Delivery History ──

export async function getWebhookDeliveries(
  agentId: string,
  limit = 20,
  offset = 0
) {
  return db
    .select({
      id: webhookDeliveries.id,
      eventType: webhookDeliveries.eventType,
      webhookUrl: webhookDeliveries.webhookUrl,
      statusCode: webhookDeliveries.statusCode,
      attempt: webhookDeliveries.attempt,
      status: webhookDeliveries.status,
      errorMessage: webhookDeliveries.errorMessage,
      createdAt: webhookDeliveries.createdAt,
      deliveredAt: webhookDeliveries.deliveredAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.agentId, agentId))
    .orderBy(sql`${webhookDeliveries.createdAt} DESC`)
    .limit(limit)
    .offset(offset);
}
