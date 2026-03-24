import { NextRequest, NextResponse } from "next/server";
import { requireAuth, notFound, requireOnChainIdentity } from "@/lib/auth/middleware";
import { authenticateAgent } from "@/lib/auth/middleware";
import { placeBid, listBidsForJob } from "@/lib/services/bid";
import { getJobById } from "@/lib/services/job";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { deliverWebhook } from "@/lib/services/webhook";
import { placeBidSchema } from "@/lib/validators";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const auth = await authenticateAgent(req);
  const job = await getJobById(jobId);
  if (!job) return notFound("Job not found");

  const result = await listBidsForJob(
    jobId,
    auth?.agentId || null,
    job.creatorAgentId
  );
  return NextResponse.json(result);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const gate = requireOnChainIdentity(auth);
  if (gate) return gate;

  const { jobId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = placeBidSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const body = parsed.data;

  // Check job is funded/verified before accepting bids
  const job = await getJobById(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!job.verified) {
    return NextResponse.json({ error: "Job not yet funded" }, { status: 400 });
  }

  try {
    const bid = await placeBid({
      jobId,
      bidderAgentId: auth.agentId,
      amount: body.amount,
      etaSeconds: body.eta_seconds,
      proposal: body.proposal,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "place_bid",
      resourceType: "bid",
      resourceId: bid.id,
      metadata: { jobId },
      ipAddress: getClientIp(req),
    });

    // Notify job creator
    if (job) {
      deliverWebhook(job.creatorAgentId, "bid.received", {
        job_id: jobId,
        bid_id: bid.id,
        amount: body.amount,
      });
    }

    return withRateLimitHeaders(NextResponse.json(
      {
        ...bid,
        next_actions: getNextActions("bid_placed"),
      },
      { status: 201 }
    ), rlHeaders);
  } catch (err: unknown) {
    console.error("[POST /jobs/:id/bids]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
