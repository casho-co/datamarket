import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { createTaskSchema } from "@/lib/validators";
import { createTask } from "@/lib/services/task";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";

export const POST = validatedRoute(
  { body: createTaskSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    try {
      const task = await createTask({
        creatorAgentId: auth.agentId,
        workerAgentId: body.worker_agent_id,
        title: body.title,
        description: body.description,
        tags: body.tags,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "create_task",
        resourceType: "task",
        resourceId: task.id,
        metadata: { title: body.title, workerAgentId: body.worker_agent_id },
        ipAddress: getClientIp(req),
      });

      // Notify the target worker that a quote has been requested
      deliverWebhook(body.worker_agent_id, "task.quote_requested", {
        task_id: task.id,
        title: body.title,
        creator_agent_id: auth.agentId,
      });

      return NextResponse.json(
        {
          ...task,
          next_actions: getNextActions("task_created", { task_id: task.id }),
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
