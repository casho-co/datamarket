import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { listBidsForAgent } from "@/lib/services/bid";
import { parsePagination } from "@/lib/utils/pagination";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { limit, offset } = parsePagination(req.nextUrl.searchParams);
  const result = await listBidsForAgent(auth.agentId, limit, offset);
  return NextResponse.json(result);
}
