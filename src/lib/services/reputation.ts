import { db } from "@/lib/db";
import { reputation, reviews } from "@/lib/db/schema";
import { eq, sql, avg } from "drizzle-orm";

// ── Reputation Tiers ──

export type ReputationTier =
  | "NEW"
  | "BEGINNER"
  | "RELIABLE"
  | "TRUSTED"
  | "EXPERT"
  | "ELITE";

export interface TierInfo {
  tier: ReputationTier;
  label: string;
  minScore: number;
  maxScore: number;
  perks: string[];
}

const TIERS: TierInfo[] = [
  {
    tier: "NEW",
    label: "New Agent",
    minScore: 0,
    maxScore: 15,
    perks: [],
  },
  {
    tier: "BEGINNER",
    label: "Beginner",
    minScore: 16,
    maxScore: 35,
    perks: ["bid_on_jobs"],
  },
  {
    tier: "RELIABLE",
    label: "Reliable",
    minScore: 36,
    maxScore: 55,
    perks: ["bid_on_jobs", "priority_listing"],
  },
  {
    tier: "TRUSTED",
    label: "Trusted Agent",
    minScore: 56,
    maxScore: 75,
    perks: ["bid_on_jobs", "priority_listing", "dispute_resolver"],
  },
  {
    tier: "EXPERT",
    label: "Expert",
    minScore: 76,
    maxScore: 90,
    perks: [
      "bid_on_jobs",
      "priority_listing",
      "dispute_resolver",
      "featured",
    ],
  },
  {
    tier: "ELITE",
    label: "Elite Agent",
    minScore: 91,
    maxScore: 100,
    perks: [
      "bid_on_jobs",
      "priority_listing",
      "dispute_resolver",
      "featured",
      "reduced_fees",
    ],
  },
];

export function getTierForScore(score: number): TierInfo {
  const clamped = Math.max(0, Math.min(100, score));
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (clamped >= TIERS[i].minScore) return TIERS[i];
  }
  return TIERS[0];
}

export function getAllTiers(): TierInfo[] {
  return TIERS;
}

// ── PowerScore v2 Computation ──

export function computePowerScore(stats: {
  completedJobs: number;
  disputesLost: number;
  abandonedJobs: number;
  avgRating: number;
  totalReviews: number;
  decayFactor: number;
}): { score: number; stars: number; tier: ReputationTier } {
  const {
    completedJobs,
    disputesLost,
    abandonedJobs,
    avgRating,
    totalReviews,
    decayFactor,
  } = stats;

  // Success Rate pillar: 0-35
  const totalResolved = completedJobs + disputesLost + abandonedJobs;
  const successRate =
    totalResolved > 0 ? (completedJobs / totalResolved) * 35 : 0;

  // Volume pillar: 0-25 (caps at 50 completed jobs)
  const volume = Math.min(completedJobs / 50, 1) * 25;

  // Ratings pillar: 0-25 (based on avg star rating, requires min 3 reviews)
  const ratings =
    totalReviews >= 3 ? (avgRating / 5) * 25 : (avgRating / 5) * 10;

  // Recency pillar: 0-15 (based on 30-day decay factor)
  const recency = Math.min(Math.max(decayFactor, 0), 1) * 15;

  // Penalties
  const penalties = disputesLost * 5 + abandonedJobs * 3;

  const rawScore = Math.round(
    successRate + volume + ratings + recency - penalties
  );
  const score = Math.max(0, Math.min(100, rawScore));

  // Stars = round to nearest 0.5
  const stars = Math.round((score / 20) * 2) / 2;

  const { tier } = getTierForScore(score);

  return { score, stars, tier };
}

// ── Update Reputation ──

export async function updateReputation(agentId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(reputation)
    .where(eq(reputation.agentId, agentId));

  if (!row) return;

  // Compute avg rating from reviews table
  const [ratingRow] = await db
    .select({
      avgRating: avg(reviews.rating),
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(eq(reviews.revieweeAgentId, agentId));

  const avgRating = ratingRow?.avgRating
    ? parseFloat(String(ratingRow.avgRating))
    : 0;
  const totalReviews = ratingRow?.count ?? 0;

  const { score, stars } = computePowerScore({
    completedJobs: row.completedJobs,
    disputesLost: row.disputesLost,
    abandonedJobs: row.abandonedJobs,
    avgRating,
    totalReviews,
    decayFactor: parseFloat(row.decayFactor),
  });

  await db
    .update(reputation)
    .set({
      score,
      rollingScore: score,
      stars: stars.toFixed(1),
      avgRating: avgRating.toFixed(1),
      totalReviews,
      lastActiveAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reputation.agentId, agentId));
}

export async function initReputation(agentId: string): Promise<void> {
  await db.insert(reputation).values({ agentId }).onConflictDoNothing();
}

// ── Decay Factor (called by cron) ──

export async function updateDecayFactor(
  agentId: string,
  recentJobsCount: number
): Promise<void> {
  const factor = Math.min(recentJobsCount / 5, 1);
  await db
    .update(reputation)
    .set({
      decayFactor: factor.toFixed(3),
      updatedAt: new Date(),
    })
    .where(eq(reputation.agentId, agentId));
}
