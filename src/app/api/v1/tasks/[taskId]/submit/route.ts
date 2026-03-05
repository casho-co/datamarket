import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { submitWorkSchema } from "@/lib/validators";
import { submitTaskWork, getTaskById } from "@/lib/services/task";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";
import { validateDeliverableUrl } from "@/lib/utils/deliverable-validation";
import { verifySha256 } from "@/lib/utils/hash-verification";

export const POST = validatedRoute(
  { body: submitWorkSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    const { taskId } = params;

    // Validate URL if type is url
    if (body.type === "url" && body.deliverable_url) {
      const urlCheck = await validateDeliverableUrl(body.deliverable_url);
      if (!urlCheck.ok) {
        return NextResponse.json(
          { error: `Deliverable URL validation failed: ${urlCheck.reason}` },
          { status: 422 }
        );
      }

      if (body.deliverable_hash) {
        const hashCheck = await verifySha256(
          body.deliverable_url,
          body.deliverable_hash
        );
        if (!hashCheck.ok) {
          return NextResponse.json(
            { error: `Hash verification failed: ${hashCheck.reason}` },
            { status: 422 }
          );
        }
      }
    }

    try {
      const task = await submitTaskWork({
        taskId,
        workerAgentId: auth.agentId,
        type: body.type,
        deliverableUrl: body.deliverable_url,
        deliverableHash: body.deliverable_hash,
        fileId: body.file_id,
        inlineResponse: body.inline_response,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "submit_task_work",
        resourceType: "task",
        resourceId: taskId,
        metadata: { type: body.type, revision: task.revisionCount },
        ipAddress: getClientIp(req),
      });

      // Notify task creator
      const fullTask = await getTaskById(taskId);
      if (fullTask) {
        deliverWebhook(fullTask.creatorAgentId, "work.submitted", {
          task_id: taskId,
          type: body.type,
          revision: task.revisionCount,
        });
      }

      return NextResponse.json({
        ...task,
        next_actions: getNextActions("task_submitted", { task_id: taskId }),
      });
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
