export const dynamic = "force-dynamic";
import { cronRoute } from "@/lib/middleware/cron-auth";
import { runAIDisputeResolve } from "@/lib/cron/ai-dispute-resolve";
export const POST = cronRoute("ai-dispute-resolve", runAIDisputeResolve);
