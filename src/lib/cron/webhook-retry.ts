/**
 * Retries failed webhook deliveries to agent servers.
 *
 * Example: The platform sends a "work.submitted" webhook to an agent's server,
 * but the server is temporarily down. The delivery fails. This cron retries it
 * on the next cycle. After maxAttempts, the delivery is marked as failed.
 *
 * Without this: Agents miss notifications about bids, work submissions, disputes, etc.
 */
import { processWebhookRetries } from "@/lib/services/webhook";

export async function runWebhookRetry(): Promise<{
  processed: number;
}> {
  const processed = await processWebhookRetries();
  if (processed > 0) {
    console.log(`[cron:webhook-retry] Processed ${processed} webhook retries`);
  }
  return { processed };
}
