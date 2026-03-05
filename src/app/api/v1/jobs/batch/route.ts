import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createJob, cancelJob } from "@/lib/services/job";
import { getAvailableBalance } from "@/lib/services/wallet";
import { MIN_BALANCE_USDC } from "@/lib/bsc/constants";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { batchCreateJobsSchema, batchCancelJobsSchema } from "@/lib/validators";
import { deliverWebhook } from "@/lib/services/webhook";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Determine operation by inspecting body
  const body = raw as Record<string, unknown>;
  const operation = body.operation as string | undefined;

  if (operation === "cancel") {
    const parsed = batchCancelJobsSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const results: { job_id: string; status: string; error?: string }[] = [];
    for (const jobId of parsed.data.job_ids) {
      try {
        await cancelJob(jobId, auth.agentId);
        results.push({ job_id: jobId, status: "cancelled" });
      } catch (err: unknown) {
        results.push({ job_id: jobId, status: "failed", error: safeErrorMessage(err) });
      }
    }

    await logAudit({
      agentId: auth.agentId,
      action: "batch_cancel_jobs",
      resourceType: "job",
      resourceId: "batch",
      metadata: { count: parsed.data.job_ids.length },
      ipAddress: getClientIp(req),
    });

    return withRateLimitHeaders(NextResponse.json({ results }), rlHeaders);
  }

  // Default: batch create
  const parsed = batchCreateJobsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const balance = await getAvailableBalance(auth.agentId);
  if (parseFloat(balance) < parseFloat(MIN_BALANCE_USDC)) {
    return NextResponse.json(
      { error: `Minimum balance of ${MIN_BALANCE_USDC} USDC required` },
      { status: 400 }
    );
  }

  const results: { index: number; job_id?: string; status: string; error?: string }[] = [];
  for (let i = 0; i < parsed.data.jobs.length; i++) {
    const j = parsed.data.jobs[i];
    try {
      const job = await createJob({
        creatorAgentId: auth.agentId,
        title: j.title,
        description: j.description,
        tags: j.tags,
        budgetAmount: j.budget_amount,
        jobType: j.job_type,
        maxSlots: j.max_slots,
        deadlineSeconds: j.deadline_seconds,
        disputeAgentId: j.dispute_agent_id,
        requiresVerifiable: j.requires_verifiable,
      });

      deliverWebhook(auth.agentId, "job.created", {
        job_id: job.id,
        title: job.title,
        budget_amount: job.budgetAmount,
        job_type: job.jobType,
      });

      results.push({ index: i, job_id: job.id, status: "created" });
    } catch (err: unknown) {
      results.push({ index: i, status: "failed", error: safeErrorMessage(err) });
    }
  }

  await logAudit({
    agentId: auth.agentId,
    action: "batch_create_jobs",
    resourceType: "job",
    resourceId: "batch",
    metadata: { count: parsed.data.jobs.length },
    ipAddress: getClientIp(req),
  });

  return withRateLimitHeaders(
    NextResponse.json({ results }, { status: 201 })
  , rlHeaders);
}
