import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { tokenLaunches } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { parsePagination } from "@/lib/utils/pagination";

// GET — List your launched tokens
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { limit, offset } = parsePagination(req.nextUrl.searchParams);

  const launches = await db
    .select()
    .from(tokenLaunches)
    .where(eq(tokenLaunches.agentId, auth.agentId))
    .orderBy(desc(tokenLaunches.createdAt))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({
    launches,
    limit,
    offset,
    count: launches.length,
  });
}
