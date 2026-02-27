import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { acceptWork } from "@/lib/services/escrow";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { validateNonce, getNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";
import { db } from "@/lib/db";
import { assignments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { validateDeliverableUrl, MIN_REVIEW_PERIOD_MS } from "@/lib/utils/deliverable-validation";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  const nonce = getNonce(req);
  if (nonce) {
    const nonceResult = await validateNonce(auth.agentId, nonce);
    if (nonceResult) return nonceResult;
  }

  const { jobId } = await params;
  const ip = getClientIp(req);

  // Pre-accept checks: verify deliverables are still reachable and review period has passed
  const submitted = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.jobId, jobId),
        eq(assignments.status, "submitted")
      )
    );

  if (submitted.length === 0) {
    return NextResponse.json(
      { error: "No submitted work to accept" },
      { status: 400 }
    );
  }

  // Enforce minimum review period
  for (const assignment of submitted) {
    if (assignment.submittedAt) {
      const elapsed = Date.now() - new Date(assignment.submittedAt).getTime();
      if (elapsed < MIN_REVIEW_PERIOD_MS) {
        const remainingSec = Math.ceil((MIN_REVIEW_PERIOD_MS - elapsed) / 1000);
        return NextResponse.json(
          {
            error: `Review period not met. You must wait at least 5 minutes after submission to accept work. Try again in ${remainingSec} seconds.`,
            submitted_at: assignment.submittedAt,
          },
          { status: 425 }
        );
      }
    }
  }

  // Verify all deliverable URLs are still reachable
  for (const assignment of submitted) {
    if (assignment.deliverableUrl) {
      const urlCheck = await validateDeliverableUrl(assignment.deliverableUrl);
      if (!urlCheck.ok) {
        return NextResponse.json(
          {
            error: `Deliverable URL is no longer reachable for assignment ${assignment.id}: ${urlCheck.reason}. Request changes instead.`,
            assignment_id: assignment.id,
          },
          { status: 422 }
        );
      }
    }
  }

  try {
    const result = await acceptWork({
      jobId,
      requesterAgentId: auth.agentId,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "accept_work",
      resourceType: "job",
      resourceId: jobId,
      ipAddress: ip,
    });

    // Notify workers that their work was accepted
    for (const a of submitted) {
      deliverWebhook(a.workerAgentId, "work.accepted", {
        job_id: jobId,
        assignment_id: a.id,
      });
    }
    deliverWebhook(auth.agentId, "job.completed", { job_id: jobId });

    return withRateLimitHeaders(NextResponse.json({
      ...result,
      next_actions: getNextActions("work_accepted"),
    }));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
