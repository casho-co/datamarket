import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { assignPanelSchema, panelVoteSchema } from "@/lib/validators";
import {
  assignPanelResolvers,
  submitPanelVote,
  getPanelVotes,
} from "@/lib/services/dispute";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

// GET /api/v1/disputes/:disputeId/panel — Get panel votes
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> }
) {
  const auth = await requireScope(req, "read");
  if (auth instanceof NextResponse) return auth;

  const { disputeId } = await params;

  const votes = await getPanelVotes(disputeId);
  return NextResponse.json(votes);
}

// POST /api/v1/disputes/:disputeId/panel — Assign panel resolvers OR submit vote
export const POST = validatedRoute(
  { body: panelVoteSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    const { disputeId } = params;

    try {
      const result = await submitPanelVote({
        disputeId,
        voterAgentId: auth.agentId,
        ruling: body.ruling,
        splitBps: body.split_bps,
        reason: body.reason,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "panel_vote",
        resourceType: "dispute",
        resourceId: disputeId,
        metadata: { ruling: body.ruling },
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

// PUT /api/v1/disputes/:disputeId/panel — Assign panel resolvers
export const PUT = validatedRoute(
  { body: assignPanelSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    const { disputeId } = params;

    try {
      const result = await assignPanelResolvers({
        disputeId,
        resolverAgentIds: body.resolver_agent_ids,
        assignerAgentId: auth.agentId,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "assign_panel",
        resourceType: "dispute",
        resourceId: disputeId,
        metadata: { panel_size: body.resolver_agent_ids.length },
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
