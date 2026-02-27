import { NextRequest, NextResponse } from "next/server";
import { getTopBscTokens } from "@/lib/bsc/lifi-swap";

// GET — Fetch top/popular BSC tokens via LiFi
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(
    Math.max(parseInt(sp.get("limit") || "50", 10), 1),
    200
  );

  try {
    const allTokens = await getTopBscTokens();
    const tokens = allTokens.slice(0, limit);

    return NextResponse.json({
      tokens,
      count: tokens.length,
      total: allTokens.length,
      chain: "BNB Smart Chain",
      source: "LiFi",
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch top tokens" },
      { status: 502 }
    );
  }
}
