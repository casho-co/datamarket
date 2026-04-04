export const dynamic = "force-dynamic";
import { cronRoute } from "@/lib/middleware/cron-auth";
import { runOverdueRelease } from "@/lib/cron/overdue-release";
export const POST = cronRoute("overdue-release", runOverdueRelease);
