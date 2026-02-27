import { db } from "@/lib/db";
import { apiUsageMetrics, apiKeys } from "@/lib/db/schema";
import { eq, and, sql, gte, desc } from "drizzle-orm";

export async function recordApiUsage(params: {
  agentId: string;
  apiKeyId?: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTimeMs?: number;
}) {
  await db.insert(apiUsageMetrics).values({
    agentId: params.agentId,
    apiKeyId: params.apiKeyId || null,
    endpoint: params.endpoint,
    method: params.method,
    statusCode: params.statusCode,
    responseTimeMs: params.responseTimeMs || null,
  });
}

export async function getApiUsageStats(agentId: string, days: number = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Overall stats
  const [overall] = await db
    .select({
      total_requests: sql<number>`COUNT(*)`,
      avg_response_time_ms: sql<number>`COALESCE(AVG(${apiUsageMetrics.responseTimeMs}), 0)`,
      success_count: sql<number>`COUNT(*) FILTER (WHERE ${apiUsageMetrics.statusCode} < 400)`,
      error_count: sql<number>`COUNT(*) FILTER (WHERE ${apiUsageMetrics.statusCode} >= 400)`,
    })
    .from(apiUsageMetrics)
    .where(
      and(
        eq(apiUsageMetrics.agentId, agentId),
        gte(apiUsageMetrics.createdAt, since)
      )
    );

  // Per-endpoint breakdown (top 20)
  const byEndpoint = await db
    .select({
      endpoint: apiUsageMetrics.endpoint,
      method: apiUsageMetrics.method,
      count: sql<number>`COUNT(*)`,
      avg_response_time_ms: sql<number>`COALESCE(AVG(${apiUsageMetrics.responseTimeMs}), 0)`,
    })
    .from(apiUsageMetrics)
    .where(
      and(
        eq(apiUsageMetrics.agentId, agentId),
        gte(apiUsageMetrics.createdAt, since)
      )
    )
    .groupBy(apiUsageMetrics.endpoint, apiUsageMetrics.method)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(20);

  // Per-key breakdown
  const byKey = await db
    .select({
      api_key_id: apiUsageMetrics.apiKeyId,
      key_prefix: apiKeys.keyPrefix,
      label: apiKeys.label,
      count: sql<number>`COUNT(*)`,
    })
    .from(apiUsageMetrics)
    .leftJoin(apiKeys, eq(apiKeys.id, apiUsageMetrics.apiKeyId))
    .where(
      and(
        eq(apiUsageMetrics.agentId, agentId),
        gte(apiUsageMetrics.createdAt, since)
      )
    )
    .groupBy(apiUsageMetrics.apiKeyId, apiKeys.keyPrefix, apiKeys.label)
    .orderBy(desc(sql`COUNT(*)`));

  // Daily volume
  const daily = await db
    .select({
      date: sql<string>`DATE(${apiUsageMetrics.createdAt})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(apiUsageMetrics)
    .where(
      and(
        eq(apiUsageMetrics.agentId, agentId),
        gte(apiUsageMetrics.createdAt, since)
      )
    )
    .groupBy(sql`DATE(${apiUsageMetrics.createdAt})`)
    .orderBy(sql`DATE(${apiUsageMetrics.createdAt})`);

  return {
    period_days: days,
    overall: overall || { total_requests: 0, avg_response_time_ms: 0, success_count: 0, error_count: 0 },
    by_endpoint: byEndpoint,
    by_key: byKey,
    daily_volume: daily,
  };
}
