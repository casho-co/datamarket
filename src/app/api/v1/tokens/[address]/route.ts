import { NextRequest, NextResponse } from "next/server";
import { getTokenInfo } from "@/lib/bsc/fourmeme";
import { db } from "@/lib/db";
import { tokenLaunches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type RouteContext = { params: Promise<{ address: string }> };

// GET — Get token info (on-chain + API + platform data)
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { address } = await ctx.params;

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json(
      { error: "Invalid token address" },
      { status: 400 }
    );
  }

  try {
    // Fetch on-chain + Four.meme API data in parallel with platform record
    const [tokenInfo, platformLaunches] = await Promise.all([
      getTokenInfo(address),
      db
        .select()
        .from(tokenLaunches)
        .where(eq(tokenLaunches.tokenAddress, address))
        .limit(1),
    ]);

    const platformData = platformLaunches[0] || null;

    return NextResponse.json({
      ...tokenInfo,
      platform: platformData
        ? {
            launched_by_agent: platformData.agentId,
            launch_id: platformData.id,
            launched_at: platformData.launchedAt,
            tx_hash: platformData.txHash,
          }
        : null,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to fetch token info",
      },
      { status: 502 }
    );
  }
}
