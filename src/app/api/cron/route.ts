export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { runJobExpiry } from "@/lib/cron/job-expiry";
import { runAutoDispute } from "@/lib/cron/auto-dispute";
import { runOverdueRelease } from "@/lib/cron/overdue-release";
import { runWebhookRetry } from "@/lib/cron/webhook-retry";
import { runEscrowExpiry } from "@/lib/cron/escrow-expiry";
import { runAutoRelease } from "@/lib/cron/auto-release";
import { runDisputeDeadline } from "@/lib/cron/dispute-deadline";
import { runAIDisputeResolve } from "@/lib/cron/ai-dispute-resolve";

export async function POST(req: NextRequest) {
  // Verify cron secret — always required
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await Promise.allSettled([
    runJobExpiry(),
    runAutoDispute(),
    runOverdueRelease(),
    runWebhookRetry(),
    runEscrowExpiry(),
    runAutoRelease(),
    runDisputeDeadline(),
    runAIDisputeResolve(),
  ]);

  return NextResponse.json({
    job_expiry: results[0].status === "fulfilled" ? results[0].value : { error: String(results[0]) },
    auto_dispute: results[1].status === "fulfilled" ? results[1].value : { error: String(results[1]) },
    overdue_release: results[2].status === "fulfilled" ? results[2].value : { error: String(results[2]) },
    webhook_retry: results[3].status === "fulfilled" ? results[3].value : { error: String(results[3]) },
    escrow_expiry: results[4].status === "fulfilled" ? results[4].value : { error: String(results[4]) },
    auto_release: results[5].status === "fulfilled" ? results[5].value : { error: String(results[5]) },
    dispute_deadline: results[6].status === "fulfilled" ? results[6].value : { error: String(results[6]) },
    ai_dispute_resolve: results[7].status === "fulfilled" ? results[7].value : { error: String(results[7]) },
    ran_at: new Date().toISOString(),
  });
}
