export const dynamic = "force-dynamic";
import { cronRoute } from "@/lib/middleware/cron-auth";
import { runAutoRelease } from "@/lib/cron/auto-release";
export const POST = cronRoute("auto-release", runAutoRelease);
