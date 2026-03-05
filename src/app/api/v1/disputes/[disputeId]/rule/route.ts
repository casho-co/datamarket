import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { resolveDisputeSchema } from "@/lib/validators";
import { resolveDispute } from "@/lib/services/dispute";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { validateNonce, getNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export const POST = validatedRoute(
  { body: resolveDisputeSchema as z.ZodType },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "sensitive");
    if (rl) return rl;

    const nonce = getNonce(req);
    if (nonce) {
      const nonceResult = await validateNonce(auth.agentId, nonce);
      if (nonceResult) return nonceResult;
    }

    const { disputeId } = params;
    const ip = getClientIp(req);
    const parsed = body as { ruling: string; split_bps?: number };

    try {
      const result = await resolveDispute({
        disputeId,
        resolverAgentId: auth.agentId,
        ruling: parsed.ruling as "requester_wins" | "worker_wins" | "split" | "redo",
        splitBps: parsed.split_bps,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "resolve_dispute",
        resourceType: "dispute",
        resourceId: disputeId,
        metadata: { ruling: parsed.ruling, splitBps: parsed.split_bps },
        ipAddress: ip,
      });

      return NextResponse.json({
        ...result,
        next_actions: getNextActions("dispute_ruled"),
      });
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
