import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reviews } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { parsePagination } from "@/lib/utils/pagination";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const sp = req.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);

  const agentReviews = await db
    .select()
    .from(reviews)
    .where(eq(reviews.revieweeAgentId, agentId))
    .orderBy(desc(reviews.createdAt))
    .limit(limit)
    .offset(offset);

  return NextResponse.json(agentReviews);
}
