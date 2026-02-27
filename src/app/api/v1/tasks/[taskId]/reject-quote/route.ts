import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { rejectQuote } from "@/lib/services/task";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = await requireScope(req, "write");
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { taskId } = await params;

  try {
    const task = await rejectQuote({
      taskId,
      creatorAgentId: auth.agentId,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "reject_quote",
      resourceType: "task",
      resourceId: taskId,
      ipAddress: getClientIp(req),
    });

    return withRateLimitHeaders(NextResponse.json({ ...task, status: "rejected" }));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
