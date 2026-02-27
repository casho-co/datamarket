import { NextRequest, NextResponse } from "next/server";
import { listBidsForAgent } from "@/lib/services/bid";
import { parsePagination } from "@/lib/utils/pagination";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const { limit, offset } = parsePagination(req.nextUrl.searchParams);
  const result = await listBidsForAgent(agentId, limit, offset);
  return NextResponse.json(result);
}
