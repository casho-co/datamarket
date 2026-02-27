import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getCrossChainQuote } from "@/lib/services/cross-chain";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { crossChainQuoteSchema } from "@/lib/validators";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = crossChainQuoteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const quote = await getCrossChainQuote({
      agentId: auth.agentId,
      sourceChain: parsed.data.source_chain,
      sourceToken: parsed.data.source_token,
      amount: parsed.data.amount,
      destinationToken: parsed.data.destination_token,
    });

    return withRateLimitHeaders(NextResponse.json(quote));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
