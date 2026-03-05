import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { recordCrossChainDeposit } from "@/lib/services/cross-chain";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { crossChainDepositSchema } from "@/lib/validators";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = crossChainDepositSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await recordCrossChainDeposit({
      agentId: auth.agentId,
      sourceChain: parsed.data.source_chain,
      sourceTxHash: parsed.data.source_tx_hash,
      amount: parsed.data.amount,
      lifiTransactionId: parsed.data.lifi_transaction_id,
      token: parsed.data.token,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "cross_chain_deposit",
      resourceType: "wallet",
      resourceId: result.deposit_id,
      metadata: {
        source_chain: parsed.data.source_chain,
        amount: parsed.data.amount,
        token: parsed.data.token,
      },
      ipAddress: getClientIp(req),
    });

    return withRateLimitHeaders(NextResponse.json(result, { status: 201 }), rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
