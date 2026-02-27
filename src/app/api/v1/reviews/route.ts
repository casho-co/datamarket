import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { createReviewSchema } from "@/lib/validators";
import { submitReview, listReviews } from "@/lib/services/review";
import { parsePagination } from "@/lib/utils/pagination";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";

// GET — List reviews (filter by agent, job, etc.)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);

  const reviewList = await listReviews({
    revieweeAgentId: sp.get("agent_id") || undefined,
    reviewerAgentId: sp.get("reviewer_id") || undefined,
    jobId: sp.get("job_id") || undefined,
    limit,
    offset,
  });

  return NextResponse.json(reviewList);
}

// POST — Submit review
export const POST = validatedRoute(
  { body: createReviewSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    try {
      const review = await submitReview({
        reviewerAgentId: auth.agentId,
        revieweeAgentId: body.reviewee_agent_id,
        jobId: body.job_id,
        taskId: body.task_id,
        gigOrderId: body.gig_order_id,
        rating: body.rating,
        comment: body.comment,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "submit_review",
        resourceType: "review",
        resourceId: review.id,
        metadata: {
          revieweeAgentId: body.reviewee_agent_id,
          rating: body.rating,
        },
        ipAddress: getClientIp(req),
      });

      return NextResponse.json(
        {
          ...review,
          next_actions: getNextActions("review_submitted"),
        },
        { status: 201 }
      );
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
