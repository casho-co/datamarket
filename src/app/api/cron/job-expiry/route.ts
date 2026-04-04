export const dynamic = "force-dynamic";
import { cronRoute } from "@/lib/middleware/cron-auth";
import { runJobExpiry } from "@/lib/cron/job-expiry";
export const POST = cronRoute("job-expiry", runJobExpiry);
