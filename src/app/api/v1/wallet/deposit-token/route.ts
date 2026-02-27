import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { depositWithTokenSchema } from "@/lib/validators";
import { db } from "@/lib/db";
import { agents, deposits } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { creditBalance } from "@/lib/services/wallet";
import { TOKEN_ADDRESSES, type SupportedToken } from "@/lib/bsc/constants";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { validateNonce, getNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { shouldSkipOnChainVerification } from "@/lib/middleware/sandbox";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  const nonce = getNonce(req);
  if (nonce) {
    const nonceResult = await validateNonce(auth.agentId, nonce);
    if (nonceResult) return nonceResult;
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = depositWithTokenSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const token = parsed.data.token as SupportedToken;
  const tokenAddress = TOKEN_ADDRESSES[token];

  const [agent] = await db
    .select({ walletAddress: agents.walletAddress })
    .from(agents)
    .where(eq(agents.id, auth.agentId));

  if (!agent?.walletAddress) {
    return NextResponse.json(
      { error: "Agent wallet address not found" },
      { status: 400 }
    );
  }

  try {
    const [deposit] = await db
      .insert(deposits)
      .values({
        agentId: auth.agentId,
        amount: parsed.data.amount,
        txHash: parsed.data.tx_hash,
      })
      .onConflictDoNothing()
      .returning();

    if (!deposit) {
      return NextResponse.json(
        { error: "Transaction already processed" },
        { status: 409 }
      );
    }

    await logAudit({
      agentId: auth.agentId,
      action: "deposit",
      resourceType: "wallet",
      resourceId: deposit.id,
      metadata: {
        txHash: parsed.data.tx_hash,
        amount: parsed.data.amount,
        token,
        tokenAddress,
      },
      ipAddress: getClientIp(req),
    });

    // In sandbox mode, auto-confirm deposits
    if (shouldSkipOnChainVerification()) {
      await db
        .update(deposits)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(eq(deposits.id, deposit.id));

      await creditBalance(auth.agentId, parsed.data.amount);

      return withRateLimitHeaders(
        NextResponse.json({
          deposit_id: deposit.id,
          status: "confirmed",
          amount: parsed.data.amount,
          token,
          sandbox: true,
        })
      );
    }

    return withRateLimitHeaders(
      NextResponse.json({
        deposit_id: deposit.id,
        status: "pending",
        amount: parsed.data.amount,
        token,
        message: `${token} deposit recorded and will be verified shortly`,
      })
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
