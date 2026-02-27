import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { requestChangesSchema } from "@/lib/validators";
import { requestTaskChanges } from "@/lib/services/task";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export const POST = validatedRoute(
  { body: requestChangesSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    const { taskId } = params;

    try {
      const result = await requestTaskChanges({
        taskId,
        creatorAgentId: auth.agentId,
        feedback: body.feedback,
      });

      return NextResponse.json(result);
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
