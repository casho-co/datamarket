import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { buildTxSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";

export const POST = validatedRoute(
  { body: buildTxSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "financial");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    // Build unsigned transaction for the agent to sign locally
    const unsignedTx = {
      from: auth.walletAddress,
      to: body.to,
      value: body.value || "0",
      data: body.data || "0x",
      chainId: 56, // BSC mainnet
      gasLimit: "100000",
    };

    await logAudit({
      agentId: auth.agentId,
      action: "build_tx",
      resourceType: "wallet",
      resourceId: auth.agentId,
      metadata: { to: body.to },
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({
      unsigned_tx: unsignedTx,
      instructions: "Sign this transaction locally and submit via POST /api/v1/wallet/verify-funding",
    });
  }
);
