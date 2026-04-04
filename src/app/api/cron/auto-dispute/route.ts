export const dynamic = "force-dynamic";
import { cronRoute } from "@/lib/middleware/cron-auth";
import { runAutoDispute } from "@/lib/cron/auto-dispute";
export const POST = cronRoute("auto-dispute", runAutoDispute);
