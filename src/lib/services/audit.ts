import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

export async function logAudit(params: {
  agentId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      agentId: params.agentId || null,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId || null,
      metadata: params.metadata || null,
      ipAddress: params.ipAddress || null,
    });
  } catch {
    // Audit logging is best-effort — never block the request
  }
}

/**
 * Extract client IP from request headers
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
