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
  erc8004AgentId: bigint | null;
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
      erc8004AgentId: agents.erc8004AgentId,
    })
    .from(agents)
    .where(eq(agents.id, payload.agentId));

  if (!agent) return null;

  return {
    agentId: agent.id,
    walletAddress: agent.walletAddress,
    handle: agent.handle,
    scopes: payload.scopes,
    erc8004AgentId: agent.erc8004AgentId,
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
      expiresAt: apiKeys.expiresAt,
      agentId: agents.id,
      walletAddress: agents.walletAddress,
      handle: agents.handle,
      erc8004AgentId: agents.erc8004AgentId,
    })
    .from(apiKeys)
    .innerJoin(agents, eq(apiKeys.agentId, agents.id))
    .where(and(eq(apiKeys.keyPrefix, prefix), eq(apiKeys.isActive, true)));

  for (const k of matchingKeys) {
    if (k.expiresAt && k.expiresAt < new Date()) continue;

    const valid = await verifyApiKey(key, k.keyHash);
    if (!valid) continue;

    // Update last used timestamp (non-blocking)
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, k.keyId))
      .catch(() => {});

    return {
      agentId: k.agentId,
      walletAddress: k.walletAddress,
      handle: k.handle,
      scopes: k.scopes as string[],
      erc8004AgentId: k.erc8004AgentId,
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

/**
 * Require on-chain ERC-8004 identity for financial actions.
 * Returns null if identity exists, or 403 response with next_actions if missing.
 */
export function requireOnChainIdentity(auth: AgentAuth): NextResponse | null {
  if (!auth.erc8004AgentId) {
    return NextResponse.json(
      {
        error: "On-chain identity required",
        message:
          "You must mint or link an ERC-8004 identity before performing financial actions.",
        next_actions: [
          {
            action: "mint_identity",
            method: "POST",
            path: "/api/v1/agents/mint-identity",
            description: "Get unsigned transaction to mint your on-chain identity",
          },
          {
            action: "link_identity",
            method: "POST",
            path: "/api/v1/agents/link-identity",
            description: "Link an existing ERC-8004 identity NFT",
          },
          {
            action: "list_identities",
            method: "GET",
            path: "/api/v1/agents/identities",
            description: "List your existing ERC-8004 identity NFTs",
          },
        ],
      },
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
