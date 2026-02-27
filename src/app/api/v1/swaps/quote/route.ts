import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { swapQuoteSchema } from "@/lib/validators";
import { getSwapQuote } from "@/lib/bsc/lifi-swap";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

// POST — Get a swap quote via LiFi (PancakeSwap + DEX aggregation)
export const POST = validatedRoute(
  { body: swapQuoteSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "read");
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    try {
      const quote = await getSwapQuote({
        fromToken: body.from_token,
        toToken: body.to_token,
        amount: body.amount,
        fromChain: body.from_chain,
        toChain: body.to_chain,
        slippage: body.slippage,
      });

      return NextResponse.json({
        quote: {
          from_token: quote.fromToken,
          to_token: quote.toToken,
          from_amount: quote.fromAmount,
          to_amount: quote.toAmountHuman,
          to_amount_raw: quote.toAmount,
          estimated_gas_usd: quote.estimatedGasUSD,
          estimated_time_seconds: quote.estimatedTimeSeconds,
          tool: quote.tool,
        },
        source: "LiFi",
        chain: body.from_chain,
      });
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 500 }
      );
    }
  }
);
