import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getApiUsageStats } from "@/lib/services/api-usage";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const daysParam = req.nextUrl.searchParams.get("days");
  const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 30, 1), 90) : 30;

  const stats = await getApiUsageStats(auth.agentId, days);
  return NextResponse.json(stats);
}
