import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { completeDelegation } from "@/lib/services/delegation";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ delegationId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { delegationId } = await params;

  try {
    const delegation = await completeDelegation(delegationId, auth.agentId);
    return withRateLimitHeaders(NextResponse.json(delegation), rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
