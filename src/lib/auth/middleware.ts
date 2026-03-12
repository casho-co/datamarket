import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agents, apiKeys } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyApiKey, API_KEY_PREFIX_LENGTH } from "./api-key";
import { verifySessionToken } from "./jwt";
import type { Scope } from "./scopes";

export interface AgentAuth {
  agentId: string;
  walletAddress: string | null;
  handle: string | null;
  scopes: string[];
}

/**
 * Authenticate via Bearer token.
 * Supports two paths:
 *   1. API key (sk_live_*) — permanent, for programmatic access
 *   2. JWT session (eyJ*) — 24h expiry, for web UI sessions
 */
export async function authenticateAgent(
  req: NextRequest
): Promise<AgentAuth | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);

  // Path 1: API key
  if (token.startsWith("sk_live_")) {
    return authenticateWithApiKey(token);
  }

  // Path 2: JWT session token
  if (token.startsWith("eyJ")) {
    return authenticateWithJwt(token);
  }

  return null;
}

async function authenticateWithJwt(
  token: string
): Promise<AgentAuth | null> {
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  // Verify agent still exists
  const [agent] = await db
    .select({
      id: agents.id,
      walletAddress: agents.walletAddress,
      handle: agents.handle,
    })
    .from(agents)
    .where(eq(agents.id, payload.agentId));

  if (!agent) return null;

  return {
    agentId: agent.id,
    walletAddress: agent.walletAddress,
    handle: agent.handle,
    scopes: payload.scopes,
  };
}

async function authenticateWithApiKey(
  key: string
): Promise<AgentAuth | null> {
  const prefix = key.slice(0, API_KEY_PREFIX_LENGTH);

  const matchingKeys = await db
    .select({
      keyId: apiKeys.id,
      keyHash: apiKeys.keyHash,
      scopes: apiKeys.scopes,
      isActive: apiKeys.isActive,
      expiresAt: apiKeys.expiresAt,
      agentId: apiKeys.agentId,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), eq(apiKeys.isActive, true)));

  for (const k of matchingKeys) {
    // Check expiry
    if (k.expiresAt && k.expiresAt < new Date()) continue;

    const valid = await verifyApiKey(key, k.keyHash);
    if (!valid) continue;

    // Update last used timestamp (non-blocking)
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, k.keyId))
      .catch(() => {});

    // Fetch agent
    const [agent] = await db
      .select({
        id: agents.id,
        walletAddress: agents.walletAddress,
        handle: agents.handle,
      })
      .from(agents)
      .where(eq(agents.id, k.agentId));

    if (!agent) return null;

    return {
      agentId: agent.id,
      walletAddress: agent.walletAddress,
      handle: agent.handle,
      scopes: k.scopes as string[],
    };
  }

  return null;
}

/**
 * Require authentication. Returns AgentAuth or 401 response.
 */
export async function requireAuth(
  req: NextRequest
): Promise<AgentAuth | NextResponse> {
  const auth = await authenticateAgent(req);
  if (!auth) {
    return unauthorized();
  }
  return auth;
}

/**
 * Require authentication with specific scope.
 */
export async function requireScope(
  req: NextRequest,
  scope: Scope
): Promise<AgentAuth | NextResponse> {
  const auth = await authenticateAgent(req);
  if (!auth) return unauthorized();
  if (!auth.scopes.includes(scope)) {
    return forbidden(`Insufficient scope. Required: ${scope}`);
  }
  return auth;
}

// Response helpers

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden(message = "Forbidden"): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = "Not found"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function conflict(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 409 });
}
