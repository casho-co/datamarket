import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { sellTokenSchema } from "@/lib/validators";
import { sellToken } from "@/lib/bsc/fourmeme";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

// POST — Sell token via Four.meme bonding curve (pre-PancakeSwap)
export const POST = validatedRoute(
  { body: sellTokenSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "financial");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    try {
      const result = await sellToken({
        tokenAddress: body.token_address,
        tokenAmount: body.token_amount,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "sell_token",
        resourceType: "token_trade",
        resourceId: body.token_address,
        metadata: {
          tokenAddress: body.token_address,
          tokenAmount: body.token_amount,
          txHash: result.txHash,
        },
        ipAddress: getClientIp(req),
      });

      return NextResponse.json({
        success: true,
        tx_hash: result.txHash,
        token_address: body.token_address,
        token_amount: body.token_amount,
        explorer: result.explorer,
        platform: "Four.meme",
      });
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 500 }
      );
    }
  }
);
