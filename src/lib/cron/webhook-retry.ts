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
