import { db } from "@/lib/db";
import {
  agentWallets,
  jobs,
  tasks,
  gigOrders,
  bountyClaims,
  reviews,
  reputation,
  assignments,
  escrows,
} from "@/lib/db/schema";
import { eq, and, sql, gte } from "drizzle-orm";

export async function getAgentAnalytics(agentId: string) {
  // Earnings breakdown
  const [wallet] = await db
    .select()
    .from(agentWallets)
    .where(eq(agentWallets.agentId, agentId));

  const [rep] = await db
    .select()
    .from(reputation)
    .where(eq(reputation.agentId, agentId));

  // Jobs created and completed
  const [jobStats] = await db
    .select({
      created: sql<number>`COUNT(*) FILTER (WHERE ${jobs.creatorAgentId} = ${agentId})`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${jobs.status} = 'completed' AND ${jobs.creatorAgentId} = ${agentId})`,
    })
    .from(jobs)
    .where(eq(jobs.creatorAgentId, agentId));

  // Assignments worked
  const [assignmentStats] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      accepted: sql<number>`COUNT(*) FILTER (WHERE ${assignments.status} = 'accepted')`,
      in_progress: sql<number>`COUNT(*) FILTER (WHERE ${assignments.status} = 'in_progress')`,
    })
    .from(assignments)
    .where(eq(assignments.workerAgentId, agentId));

  // Tasks
  const [taskStats] = await db
    .select({
      requested: sql<number>`COUNT(*) FILTER (WHERE ${tasks.creatorAgentId} = ${agentId})`,
      worked: sql<number>`COUNT(*) FILTER (WHERE ${tasks.workerAgentId} = ${agentId})`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
    })
    .from(tasks)
    .where(
      sql`${tasks.creatorAgentId} = ${agentId} OR ${tasks.workerAgentId} = ${agentId}`
    );

  // Gig orders
  const [gigStats] = await db
    .select({
      sold: sql<number>`COUNT(*) FILTER (WHERE ${gigOrders.sellerAgentId} = ${agentId})`,
      bought: sql<number>`COUNT(*) FILTER (WHERE ${gigOrders.buyerAgentId} = ${agentId})`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${gigOrders.status} = 'completed')`,
    })
    .from(gigOrders)
    .where(
      sql`${gigOrders.sellerAgentId} = ${agentId} OR ${gigOrders.buyerAgentId} = ${agentId}`
    );

  // Reviews received
  const [reviewStats] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      avg_rating: sql<number>`COALESCE(AVG(${reviews.rating}), 0)`,
    })
    .from(reviews)
    .where(eq(reviews.revieweeAgentId, agentId));

  // Earnings over last 30 days (from escrows released to this agent)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentEarnings = await db
    .select({
      date: sql<string>`DATE(${escrows.releasedAt})`,
      total: sql<string>`SUM(CAST(${escrows.amount} AS DECIMAL))`,
    })
    .from(escrows)
    .where(
      and(
        eq(escrows.recipientAgentId, agentId),
        eq(escrows.status, "released"),
        gte(escrows.releasedAt, thirtyDaysAgo)
      )
    )
    .groupBy(sql`DATE(${escrows.releasedAt})`)
    .orderBy(sql`DATE(${escrows.releasedAt})`);

  return {
    wallet: {
      balance: wallet?.balance || "0",
      total_deposited: wallet?.totalDeposited || "0",
      total_earned: wallet?.totalEarned || "0",
      total_withdrawn: wallet?.totalWithdrawn || "0",
    },
    reputation: {
      score: rep?.score || 0,
      tier: getTier(rep?.score || 0),
      avg_rating: rep?.avgRating || "0.0",
      total_reviews: rep?.totalReviews || 0,
      completed_jobs: rep?.completedJobs || 0,
    },
    jobs: jobStats || { created: 0, completed: 0 },
    assignments: assignmentStats || { total: 0, accepted: 0, in_progress: 0 },
    tasks: taskStats || { requested: 0, worked: 0, completed: 0 },
    gig_orders: gigStats || { sold: 0, bought: 0, completed: 0 },
    reviews: {
      total: reviewStats?.total || 0,
      avg_rating: Number(reviewStats?.avg_rating || 0).toFixed(1),
    },
    earnings_30d: recentEarnings,
  };
}

function getTier(score: number): string {
  if (score >= 91) return "ELITE";
  if (score >= 76) return "EXPERT";
  if (score >= 56) return "TRUSTED";
  if (score >= 36) return "RELIABLE";
  if (score >= 16) return "BEGINNER";
  return "NEW";
}
