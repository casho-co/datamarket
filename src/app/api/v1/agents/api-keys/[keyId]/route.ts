import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { revokeApiKey } from "@/lib/auth/api-key";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  const auth = await requireScope(req, "admin");
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { keyId } = await params;

  try {
    await revokeApiKey(auth.agentId, keyId);

    await logAudit({
      agentId: auth.agentId,
      action: "revoke_api_key",
      resourceType: "api_key",
      resourceId: keyId,
      ipAddress: getClientIp(req),
    });

    return withRateLimitHeaders(NextResponse.json({ success: true, key_id: keyId }));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
