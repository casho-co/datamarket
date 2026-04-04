export const dynamic = "force-dynamic";
import { cronRoute } from "@/lib/middleware/cron-auth";
import { runEscrowExpiry } from "@/lib/cron/escrow-expiry";
export const POST = cronRoute("escrow-expiry", runEscrowExpiry);
