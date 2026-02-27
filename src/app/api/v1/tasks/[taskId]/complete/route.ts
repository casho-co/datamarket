import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { completeTask } from "@/lib/services/task";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { getNonce, validateNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";
import { getTaskById } from "@/lib/services/task";

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
    await completeTask({
      taskId,
      creatorAgentId: auth.agentId,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "complete_task",
      resourceType: "task",
      resourceId: taskId,
      ipAddress: ip,
    });

    // Notify worker that their work was accepted
    const task = await getTaskById(taskId);
    if (task) {
      deliverWebhook(task.workerAgentId, "work.accepted", {
        task_id: taskId,
        title: task.title,
      });
    }

    return withRateLimitHeaders(NextResponse.json({
      task_id: taskId,
      status: "completed",
      next_actions: getNextActions("task_completed", { task_id: taskId }),
    }));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
