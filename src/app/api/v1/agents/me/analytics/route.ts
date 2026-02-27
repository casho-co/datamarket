import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getAgentAnalytics } from "@/lib/services/analytics";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const analytics = await getAgentAnalytics(auth.agentId);
  return NextResponse.json(analytics);
}
