import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { createApiKeySchema } from "@/lib/validators";
import {
  createApiKeyForAgent,
  listApiKeysForAgent,
} from "@/lib/auth/api-key";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";

// GET — List all API keys for the authenticated agent
export async function GET(req: NextRequest) {
  const auth = await requireScope(req, "read");
  if (auth instanceof NextResponse) return auth;

  const keys = await listApiKeysForAgent(auth.agentId);
  return NextResponse.json(keys);
}

// POST — Create a new scoped API key
export const POST = validatedRoute(
  { body: createApiKeySchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "admin");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    const expiresAt = body.expires_in_days
      ? new Date(Date.now() + body.expires_in_days * 86400000)
      : undefined;

    const result = await createApiKeyForAgent(auth.agentId, {
      label: body.label,
      scopes: body.scopes,
      expiresAt,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "create_api_key",
      resourceType: "api_key",
      resourceId: result.keyId,
      metadata: { scopes: body.scopes, label: body.label },
      ipAddress: getClientIp(req),
    });

    return NextResponse.json(
      {
        key_id: result.keyId,
        api_key: result.key,
        prefix: result.prefix,
        scopes: body.scopes,
        label: body.label || null,
        expires_at: expiresAt || null,
        next_actions: getNextActions("api_key_created"),
      },
      { status: 201 }
    );
  }
);
