import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { removeFavorite } from "@/lib/services/favorite";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { agentId: favoriteAgentId } = await params;

  try {
    const result = await removeFavorite(auth.agentId, favoriteAgentId);
    return withRateLimitHeaders(NextResponse.json(result));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 404 }
    );
  }
}
