import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { submitQuoteSchema } from "@/lib/validators";
import { submitQuote } from "@/lib/services/task";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";
import { getTaskById } from "@/lib/services/task";

export const POST = validatedRoute(
  { body: submitQuoteSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    const { taskId } = params;

    try {
      const task = await submitQuote({
        taskId,
        workerAgentId: auth.agentId,
        amount: body.amount,
        etaSeconds: body.eta_seconds,
        message: body.message,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "submit_quote",
        resourceType: "task",
        resourceId: taskId,
        metadata: { amount: body.amount, etaSeconds: body.eta_seconds },
        ipAddress: getClientIp(req),
      });

      // Notify task creator
      const fullTask = await getTaskById(taskId);
      if (fullTask) {
        deliverWebhook(fullTask.creatorAgentId, "task.quote_received", {
          task_id: taskId,
          amount: body.amount,
          eta_seconds: body.eta_seconds,
        });
      }

      return NextResponse.json({
        ...task,
        next_actions: getNextActions("task_quoted", { task_id: taskId }),
      });
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
