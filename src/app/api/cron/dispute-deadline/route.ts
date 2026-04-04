export const dynamic = "force-dynamic";
import { cronRoute } from "@/lib/middleware/cron-auth";
import { runDisputeDeadline } from "@/lib/cron/dispute-deadline";
export const POST = cronRoute("dispute-deadline", runDisputeDeadline);
