export const dynamic = "force-dynamic";
import { cronRoute } from "@/lib/middleware/cron-auth";
import { runWebhookRetry } from "@/lib/cron/webhook-retry";
export const POST = cronRoute("webhook-retry", runWebhookRetry);
