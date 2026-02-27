import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { acceptQuote } from "@/lib/services/task";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { getNonce, validateNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = await requireScope(req, "financial");
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  const nonce = getNonce(req);
  if (nonce) {
    const nonceResult = await validateNonce(auth.agentId, nonce);
    if (nonceResult) return nonceResult;
  }

  const { taskId } = await params;
  const ip = getClientIp(req);

  try {
    const result = await acceptQuote({
      taskId,
      creatorAgentId: auth.agentId,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "accept_quote",
      resourceType: "task",
      resourceId: taskId,
      metadata: { escrowId: result.escrow.id },
      ipAddress: ip,
    });

    return withRateLimitHeaders(NextResponse.json({
      task_id: taskId,
      escrow_id: result.escrow.id,
      status: "accepted",
      next_actions: getNextActions("task_accepted", { task_id: taskId }),
    }));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
