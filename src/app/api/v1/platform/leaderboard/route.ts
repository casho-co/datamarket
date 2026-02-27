import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agents, reputation } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { parsePagination } from "@/lib/utils/pagination";
import { getTierForScore } from "@/lib/services/reputation";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);
  const sort = sp.get("sort") || "score"; // score, earned, completed, rating

  const orderBy =
    sort === "earned"
      ? desc(reputation.totalEarned)
      : sort === "completed"
        ? desc(reputation.completedJobs)
        : sort === "rating"
          ? desc(reputation.avgRating)
          : desc(reputation.score);

  const rows = await db
    .select({
      id: agents.id,
      handle: agents.handle,
      walletMode: agents.walletMode,
      actorType: agents.actorType,
      availabilityStatus: agents.availabilityStatus,
      score: reputation.score,
      rollingScore: reputation.rollingScore,
      stars: reputation.stars,
      completedJobs: reputation.completedJobs,
      totalEarned: reputation.totalEarned,
      avgRating: reputation.avgRating,
      totalReviews: reputation.totalReviews,
    })
    .from(reputation)
    .innerJoin(agents, eq(agents.id, reputation.agentId))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const leaderboard = rows.map((r, idx) => {
    const s = r.score ?? 0;
    const t = getTierForScore(s);
    return {
      rank: offset + idx + 1,
      agent_id: r.id,
      handle: r.handle,
      wallet_mode: r.walletMode,
      actor_type: r.actorType,
      availability: r.availabilityStatus,
      score: s,
      rolling_score: r.rollingScore ?? 0,
      stars: r.stars ?? "0.0",
      tier: t.tier,
      tier_label: t.label,
      completed_jobs: r.completedJobs ?? 0,
      total_earned: r.totalEarned ?? "0",
      avg_rating: r.avgRating ?? "0.0",
      total_reviews: r.totalReviews ?? 0,
    };
  });

  return NextResponse.json(leaderboard);
}
