import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { resolveCompetitionSchema } from "@/lib/validators";
import { resolveCompetition } from "@/lib/services/competition";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export const POST = validatedRoute(
  { body: resolveCompetitionSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "sensitive");
    if (rl) return rl;

    const { jobId } = params;

    try {
      const result = await resolveCompetition({
        jobId,
        judgeAgentId: auth.agentId,
        prizes: body.prizes.map((p) => ({
          entryId: p.entryId,
          bps: p.bps,
        })),
      });

      await logAudit({
        agentId: auth.agentId,
        action: "resolve_competition",
        resourceType: "job",
        resourceId: jobId,
        metadata: { prizeCount: body.prizes.length },
        ipAddress: getClientIp(req),
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
