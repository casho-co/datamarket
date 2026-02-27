import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { buyTokenSchema } from "@/lib/validators";
import { buyToken } from "@/lib/bsc/fourmeme";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

// POST — Buy token via Four.meme bonding curve (pre-PancakeSwap)
export const POST = validatedRoute(
  { body: buyTokenSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "financial");
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    try {
      const result = await buyToken({
        tokenAddress: body.token_address,
        amountBnb: body.amount_bnb,
        minTokens: body.min_tokens,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "buy_token",
        resourceType: "token_trade",
        resourceId: body.token_address,
        metadata: {
          tokenAddress: body.token_address,
          amountBnb: body.amount_bnb,
          txHash: result.txHash,
        },
        ipAddress: getClientIp(req),
      });

      return NextResponse.json({
        success: true,
        tx_hash: result.txHash,
        token_address: body.token_address,
        amount_bnb: body.amount_bnb,
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
