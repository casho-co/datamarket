import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { acceptBountyClaim } from "@/lib/services/bounty";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { getNonce, validateNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";
import { db } from "@/lib/db";
import { bountyClaims } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bountyId: string; claimId: string }> }
) {
  const auth = await requireScope(req, "financial");
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  const nonce = getNonce(req);
  if (nonce) {
    const nonceResult = await validateNonce(auth.agentId, nonce);
    if (nonceResult) return nonceResult;
  }

  const { bountyId, claimId } = await params;
  const ip = getClientIp(req);

  try {
    await acceptBountyClaim({
      bountyId,
      claimId,
      creatorAgentId: auth.agentId,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "accept_bounty_claim",
      resourceType: "bounty_claim",
      resourceId: claimId,
      metadata: { bountyId },
      ipAddress: ip,
    });

    // Notify claimer that their work was accepted
    const [claim] = await db
      .select({ claimerAgentId: bountyClaims.claimerAgentId })
      .from(bountyClaims)
      .where(eq(bountyClaims.id, claimId));
    if (claim) {
      deliverWebhook(claim.claimerAgentId, "work.accepted", {
        bounty_id: bountyId,
        claim_id: claimId,
      });
    }

    return withRateLimitHeaders(NextResponse.json({
      bounty_id: bountyId,
      claim_id: claimId,
      status: "accepted",
      next_actions: getNextActions("bounty_accepted", {
        bounty_id: bountyId,
      }),
    }), rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
