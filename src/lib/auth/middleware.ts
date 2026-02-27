import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agents, apiKeys } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyApiKey } from "./api-key";
import { verifyPrivyToken } from "./privy";
import type { Scope } from "./scopes";

export interface AgentAuth {
  agentId: string;
  walletAddress: string | null;
  walletMode: "custodial" | "non_custodial";
  handle: string | null;
  scopes: string[];
}

/**
 * Authenticate via Bearer token.
 * Supports two modes:
 *   1. API Key (sk_live_*) — looks up in api_keys table
 *   2. Privy JWT — verifies via Privy SDK, finds agent by privyUserId
 */
export async function authenticateAgent(
  req: NextRequest
): Promise<AgentAuth | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);

  // Mode 1: API Key authentication
  if (token.startsWith("sk_live_")) {
    return authenticateWithApiKey(token);
  }

  // Mode 2: Privy JWT authentication (custodial agents)
  return authenticateWithPrivy(token);
}

async function authenticateWithApiKey(
  key: string
): Promise<AgentAuth | null> {
  const prefix = key.slice(0, 12);

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
        walletMode: agents.walletMode,
        handle: agents.handle,
      })
      .from(agents)
      .where(eq(agents.id, k.agentId));

    if (!agent) return null;

    return {
      agentId: agent.id,
      walletAddress: agent.walletAddress,
      walletMode: agent.walletMode,
      handle: agent.handle,
      scopes: k.scopes as string[],
    };
  }

  // Fallback: check legacy apiKeyPrefix on agents table (migration support)
  const prefix12 = key.slice(0, 12);
  const legacyAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.apiKeyPrefix, prefix12));

  for (const agent of legacyAgents) {
    const valid = await verifyApiKey(key, agent.apiKeyHash);
    if (valid) {
      return {
        agentId: agent.id,
        walletAddress: agent.walletAddress,
        walletMode: agent.walletMode,
        handle: agent.handle,
        scopes: ["read", "write", "financial"],
      };
    }
  }

  return null;
}

async function authenticateWithPrivy(
  token: string
): Promise<AgentAuth | null> {
  try {
    const { privyId } = await verifyPrivyToken(token);

    const [agent] = await db
      .select({
        id: agents.id,
        walletAddress: agents.walletAddress,
        walletMode: agents.walletMode,
        handle: agents.handle,
      })
      .from(agents)
      .where(eq(agents.privyUserId, privyId));

    if (!agent) return null;

    return {
      agentId: agent.id,
      walletAddress: agent.walletAddress,
      walletMode: agent.walletMode,
      handle: agent.handle,
      scopes: ["read", "write", "financial"],
    };
  } catch {
    return null;
  }
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

/**
 * Require custodial wallet mode.
 */
export function requireCustodial(auth: AgentAuth): NextResponse | null {
  if (auth.walletMode !== "custodial") {
    return NextResponse.json(
      { error: "This endpoint is only available for custodial wallets" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Require non-custodial wallet mode.
 */
export function requireNonCustodial(auth: AgentAuth): NextResponse | null {
  if (auth.walletMode !== "non_custodial") {
    return NextResponse.json(
      { error: "This endpoint is only available for non-custodial wallets" },
      { status: 403 }
    );
  }
  return null;
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
