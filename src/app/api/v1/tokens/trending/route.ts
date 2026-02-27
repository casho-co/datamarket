import { NextRequest, NextResponse } from "next/server";
import { getTrendingTokens } from "@/lib/bsc/fourmeme";
import { parsePagination } from "@/lib/utils/pagination";

// GET — Browse trending tokens on Four.meme
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { limit } = parsePagination(sp);
  const page = Math.max(parseInt(sp.get("page") || "1", 10), 1);
  const orderBy = sp.get("order_by") || "MarketCapDesc";
  const listedPancake = sp.has("listed_pancake")
    ? sp.get("listed_pancake") === "true"
    : undefined;

  try {
    const tokens = await getTrendingTokens({
      orderBy,
      pageIndex: page,
      pageSize: limit,
      listedPancake,
    });

    return NextResponse.json({
      tokens,
      page,
      limit,
      count: tokens.length,
      platform: "Four.meme",
      chain: "BNB Smart Chain",
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch trending tokens" },
      { status: 502 }
    );
  }
}
