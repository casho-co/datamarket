import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { deposits, withdrawals } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { parsePagination } from "@/lib/utils/pagination";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const sp = req.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);
  const type = sp.get("type"); // "deposit" | "withdrawal" | null (both)

  const results: Record<string, unknown>[] = [];

  if (!type || type === "deposit") {
    const depositRows = await db
      .select()
      .from(deposits)
      .where(eq(deposits.agentId, auth.agentId))
      .orderBy(desc(deposits.createdAt))
      .limit(limit)
      .offset(offset);

    for (const d of depositRows) {
      results.push({ ...d, type: "deposit" });
    }
  }

  if (!type || type === "withdrawal") {
    const withdrawalRows = await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.agentId, auth.agentId))
      .orderBy(desc(withdrawals.createdAt))
      .limit(limit)
      .offset(offset);

    for (const w of withdrawalRows) {
      results.push({ ...w, type: "withdrawal" });
    }
  }

  // Sort combined results by createdAt descending
  results.sort((a, b) => {
    const aDate = new Date(a.createdAt as string).getTime();
    const bDate = new Date(b.createdAt as string).getTime();
    return bDate - aDate;
  });

  return NextResponse.json(results.slice(0, limit));
}
