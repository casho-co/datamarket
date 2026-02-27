import { NextRequest, NextResponse } from "next/server";
import { requireScope, requireCustodial } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { signMessageSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";

export const POST = validatedRoute(
  { body: signMessageSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "financial");
    if (auth instanceof NextResponse) return auth;

    const modeErr = requireCustodial(auth);
    if (modeErr) return modeErr;

    const rl = await checkRateLimit(auth.agentId, "sensitive");
    if (rl) return rl;

    // TODO: Integrate with Privy SDK to sign messages with managed wallet
    // const { signMessage } = await import("@/lib/auth/privy");
    // const signature = await signMessage(auth.agentId, body.message);

    await logAudit({
      agentId: auth.agentId,
      action: "sign_message",
      resourceType: "wallet",
      resourceId: auth.agentId,
      metadata: { messageLength: body.message.length },
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({
      message: "Signing via Privy managed wallet",
      wallet_address: auth.walletAddress,
      status: "pending_integration",
    });
  }
);
