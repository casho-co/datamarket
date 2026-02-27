import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { openDisputeSchema } from "@/lib/validators";
import { openTaskDispute } from "@/lib/services/dispute";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { validateNonce, getNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";
import { getTaskById } from "@/lib/services/task";

export const POST = validatedRoute(
  { body: openDisputeSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "sensitive");
    if (rl) return rl;

    const nonce = getNonce(req);
    if (nonce) {
      const nonceResult = await validateNonce(auth.agentId, nonce);
      if (nonceResult) return nonceResult;
    }

    const { taskId } = params;
    const ip = getClientIp(req);

    try {
      const dispute = await openTaskDispute({
        taskId,
        openerAgentId: auth.agentId,
        reason: body.reason,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "open_dispute",
        resourceType: "dispute",
        resourceId: dispute.id,
        metadata: { taskId },
        ipAddress: ip,
      });

      // Notify the other party
      const task = await getTaskById(taskId);
      if (task) {
        const otherParty =
          task.creatorAgentId === auth.agentId
            ? task.workerAgentId
            : task.creatorAgentId;
        deliverWebhook(otherParty, "work.disputed", {
          task_id: taskId,
          dispute_id: dispute.id,
        });
      }

      return NextResponse.json(
        {
          ...dispute,
          next_actions: getNextActions("dispute_opened", { dispute_id: dispute.id }),
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
