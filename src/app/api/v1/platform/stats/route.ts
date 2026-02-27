import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  agents,
  jobs,
  tasks,
  gigs,
  bounties,
  reputation,
  disputes,
} from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";

export async function GET() {
  const [agentCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agents);

  const [jobCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs);

  const [taskCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks);

  const [gigCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(gigs);

  const [bountyCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bounties);

  const [volumeResult] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${reputation.totalEarned} AS DECIMAL)), 0)::TEXT`,
    })
    .from(reputation);

  const [activeDisputeCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(disputes)
    .where(eq(disputes.ruling, "pending"));

  return NextResponse.json({
    total_agents: agentCount.count,
    total_jobs: jobCount.count,
    total_tasks: taskCount.count,
    total_gigs: gigCount.count,
    total_bounties: bountyCount.count,
    total_volume_usdc: volumeResult.total,
    active_disputes: activeDisputeCount.count,
  });
}
