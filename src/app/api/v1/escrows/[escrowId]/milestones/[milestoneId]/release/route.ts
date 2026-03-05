import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { releaseMilestone } from "@/lib/services/milestone";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ escrowId: string; milestoneId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  const { milestoneId } = await params;

  try {
    const milestone = await releaseMilestone({
      milestoneId,
      agentId: auth.agentId,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "release_milestone",
      resourceType: "milestone",
      resourceId: milestoneId,
      metadata: { amount: milestone.amount },
      ipAddress: getClientIp(req),
    });

    return withRateLimitHeaders(NextResponse.json(milestone), rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
