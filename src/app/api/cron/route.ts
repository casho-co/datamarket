export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/middleware/cron-auth";
import { runJobExpiry } from "@/lib/cron/job-expiry";
import { runAutoDispute } from "@/lib/cron/auto-dispute";
import { runOverdueRelease } from "@/lib/cron/overdue-release";
import { runWebhookRetry } from "@/lib/cron/webhook-retry";
import { runEscrowExpiry } from "@/lib/cron/escrow-expiry";
import { runAutoRelease } from "@/lib/cron/auto-release";
import { runDisputeDeadline } from "@/lib/cron/dispute-deadline";
import { runAIDisputeResolve } from "@/lib/cron/ai-dispute-resolve";

/**
 * Combined cron endpoint — runs all crons sequentially.
 * Use individual endpoints (e.g. /api/cron/job-expiry) for production scheduling.
 * This endpoint is for dev/testing convenience.
 */
export async function POST(req: NextRequest) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const results: Record<string, unknown> = {};

  const crons = [
    { name: "job_expiry", fn: runJobExpiry },
    { name: "auto_dispute", fn: runAutoDispute },
    { name: "overdue_release", fn: runOverdueRelease },
    { name: "webhook_retry", fn: runWebhookRetry },
    { name: "escrow_expiry", fn: runEscrowExpiry },
    { name: "auto_release", fn: runAutoRelease },
    { name: "dispute_deadline", fn: runDisputeDeadline },
    { name: "ai_dispute_resolve", fn: runAIDisputeResolve },
  ];

  for (const cron of crons) {
    try {
      results[cron.name] = await cron.fn();
    } catch (err) {
      results[cron.name] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  results.ran_at = new Date().toISOString();
  return NextResponse.json(results);
}
