import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { submitTxSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { getNonce, validateNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";

export const POST = validatedRoute(
  { body: submitTxSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "financial");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "sensitive");
    if (rl) return rl;

    const nonce = getNonce(req);
    if (nonce) {
      const nonceResult = await validateNonce(auth.agentId, nonce);
      if (nonceResult) return nonceResult;
    }

    await logAudit({
      agentId: auth.agentId,
      action: "submit_tx",
      resourceType: "wallet",
      resourceId: auth.agentId,
      metadata: { txHash: body.tx_hash },
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({
      tx_hash: body.tx_hash,
      status: "submitted",
      message: "Transaction hash recorded. Verification will occur asynchronously.",
    });
  }
);
