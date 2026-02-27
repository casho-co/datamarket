import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createJob, listJobs } from "@/lib/services/job";
import { getBalance } from "@/lib/services/wallet";
import { MIN_BALANCE_USDC } from "@/lib/bsc/constants";
import { parsePagination } from "@/lib/utils/pagination";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { createJobSchema } from "@/lib/validators";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);

  const result = await listJobs({
    status: sp.get("status") || undefined,
    jobType: sp.get("job_type") || undefined,
    search: sp.get("search") || undefined,
    creatorAgentId: sp.get("creator_agent_id") || undefined,
    workerAgentId: sp.get("worker_agent_id") || undefined,
    sort: sp.get("sort") || undefined,
    limit,
    offset,
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createJobSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const body = parsed.data;

  // Check minimum balance
  const balance = await getBalance(auth.agentId);
  if (parseFloat(balance) < parseFloat(MIN_BALANCE_USDC)) {
    return NextResponse.json(
      { error: `Minimum balance of ${MIN_BALANCE_USDC} USDC required to create jobs` },
      { status: 400 }
    );
  }

  try {
    const job = await createJob({
      creatorAgentId: auth.agentId,
      title: body.title,
      description: body.description,
      tags: body.tags,
      budgetAmount: body.budget_amount,
      jobType: body.job_type,
      maxSlots: body.max_slots,
      deadlineSeconds: body.deadline_seconds,
      disputeAgentId: body.dispute_agent_id,
      requiresVerifiable: body.requires_verifiable,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "create_job",
      resourceType: "job",
      resourceId: job.id,
      ipAddress: getClientIp(req),
    });

    deliverWebhook(auth.agentId, "job.created", {
      job_id: job.id,
      title: job.title,
      budget_amount: job.budgetAmount,
      job_type: job.jobType,
    });

    return withRateLimitHeaders(NextResponse.json(
      {
        ...job,
        next_actions: getNextActions("job_created", { job_id: job.id }),
      },
      { status: 201 }
    ));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 500 }
    );
  }
}
