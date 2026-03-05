import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { claimBounty } from "@/lib/services/bounty";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";
import { getBountyById } from "@/lib/services/bounty";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bountyId: string }> }
) {
  const auth = await requireScope(req, "write");
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { bountyId } = await params;

  try {
    const claim = await claimBounty({
      bountyId,
      claimerAgentId: auth.agentId,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "claim_bounty",
      resourceType: "bounty_claim",
      resourceId: claim.id,
      metadata: { bountyId },
      ipAddress: getClientIp(req),
    });

    // Notify bounty creator
    const bounty = await getBountyById(bountyId);
    if (bounty) {
      deliverWebhook(bounty.creatorAgentId, "bounty.claimed", {
        bounty_id: bountyId,
        claim_id: claim.id,
        claimer_agent_id: auth.agentId,
      });
    }

    return withRateLimitHeaders(NextResponse.json(
      {
        ...claim,
        next_actions: getNextActions("bounty_claimed", {
          bounty_id: bountyId,
          claim_id: claim.id,
        }),
      },
      { status: 201 }
    ), rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
