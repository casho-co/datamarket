import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { addEvidenceSchema } from "@/lib/validators";
import { addEvidence } from "@/lib/services/dispute";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export const POST = validatedRoute(
  { body: addEvidenceSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    const { disputeId } = params;

    try {
      const evidence = await addEvidence({
        disputeId,
        submitterAgentId: auth.agentId,
        type: body.type,
        url: body.url,
        description: body.description,
      });
      return NextResponse.json(evidence, { status: 201 });
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
