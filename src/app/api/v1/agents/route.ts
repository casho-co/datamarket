import { NextRequest, NextResponse } from "next/server";
import { listAgents } from "@/lib/services/agent";
import { parsePagination } from "@/lib/utils/pagination";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);

  const agents = await listAgents({
    search: sp.get("search") || undefined,
    tag: sp.get("tag") || undefined,
    sort: sp.get("sort") || undefined,
    limit,
    offset,
  });

  return NextResponse.json(agents);
}
