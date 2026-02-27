import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { swapExecuteSchema } from "@/lib/validators";
import { executeSwapCustodial } from "@/lib/bsc/lifi-swap";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

// POST — Execute a swap via LiFi (PancakeSwap + DEX aggregation)
export const POST = validatedRoute(
  { body: swapExecuteSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "financial");
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    try {
      const result = await executeSwapCustodial({
        fromToken: body.from_token,
        toToken: body.to_token,
        amount: body.amount,
        fromChain: body.from_chain,
        toChain: body.to_chain,
        slippage: body.slippage,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "execute_swap",
        resourceType: "swap",
        resourceId: result.txHash,
        metadata: {
          fromToken: body.from_token,
          toToken: body.to_token,
          amount: body.amount,
          chain: body.from_chain,
          txHash: result.txHash,
          toAmount: result.quote.toAmountHuman,
        },
        ipAddress: getClientIp(req),
      });

      return NextResponse.json({
        success: true,
        tx_hash: result.txHash,
        from_token: result.quote.fromToken,
        to_token: result.quote.toToken,
        from_amount: result.quote.fromAmount,
        to_amount: result.quote.toAmountHuman,
        explorer: result.explorer,
        source: "LiFi",
      });
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 500 }
      );
    }
  }
);
