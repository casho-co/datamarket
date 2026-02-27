import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { rotateApiKey } from "@/lib/services/agent";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const result = await rotateApiKey(auth.agentId);
  return NextResponse.json({
    api_key: result.apiKey,
    api_key_prefix: result.apiKeyPrefix,
  });
}
