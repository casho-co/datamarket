import { db } from "@/lib/db";
import { agents, reputation, apiKeys } from "@/lib/db/schema";
import { eq, ilike, or, desc, sql, and, type SQL } from "drizzle-orm";
import {
  generateApiKey,
  hashApiKey,
  createApiKeyForAgent,
} from "@/lib/auth/api-key";
import {
  registerAgentOnChain,
  setAgentWalletOnChain,
  getOnChainReputation,
} from "@/lib/bsc/erc8004";
import { verifyPrivyToken, getPrivyUserWallet } from "@/lib/auth/privy";
import { DEFAULT_SCOPES } from "@/lib/auth/scopes";
import { getAgentBalance } from "./wallet";
import { initReputation, getTierForScore } from "./reputation";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function agentLookupCondition(identifier: string): SQL {
  if (UUID_RE.test(identifier)) return eq(agents.id, identifier);
  return eq(agents.handle, identifier);
}

// ── ERC-8004 On-Chain Registration Helper ──

async function registerAndLinkOnChain(
  handle: string | null | undefined,
  walletAddress: string | null | undefined
): Promise<bigint | null> {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || "https://datalayer-market.fly.dev";
    const identifier = handle || walletAddress || "agent";
    const agentURI = `${baseUrl}/api/v1/agents/${identifier}`;
    const erc8004AgentId = await registerAgentOnChain(agentURI);

    // Link the agent's wallet address on-chain so other platforms can discover it
    if (walletAddress && erc8004AgentId) {
      try {
        await setAgentWalletOnChain(erc8004AgentId, walletAddress);
      } catch {
        // setAgentWallet is best-effort — registration still succeeded
      }
    }

    return erc8004AgentId;
  } catch {
    // On-chain registration may fail; continue with off-chain only
    return null;
  }
}

// ── Registration (Dual-Mode) ──

export async function registerNonCustodialAgent(params: {
  walletAddress: string;
  handle?: string;
  description?: string;
  tags?: string[];
  skillTags?: string[];
  capabilities?: Record<string, unknown>;
  actorType?: "human" | "agent";
  webhookUrl?: string;
  mcpEndpoint?: string;
}) {
  // Generate legacy API key fields on agents table (for backward compat)
  const { key, prefix } = generateApiKey();
  const hash = await hashApiKey(key);

  // Register on-chain with ERC-8004 + link wallet
  const erc8004AgentId = await registerAndLinkOnChain(
    params.handle,
    params.walletAddress
  );

  const [agent] = await db
    .insert(agents)
    .values({
      walletAddress: params.walletAddress,
      walletMode: "non_custodial",
      handle: params.handle || null,
      description: params.description || null,
      tags: params.tags || [],
      skillTags: params.skillTags || [],
      capabilities: params.capabilities || {},
      actorType: params.actorType || "agent",
      webhookUrl: params.webhookUrl || null,
      mcpEndpoint: params.mcpEndpoint || null,
      apiKeyHash: hash,
      apiKeyPrefix: prefix,
      erc8004AgentId,
    })
    .returning();

  // Create scoped API key in api_keys table
  const apiKeyResult = await createApiKeyForAgent(agent.id, {
    label: "default",
    scopes: [...DEFAULT_SCOPES],
  });

  await initReputation(agent.id);

  return {
    agentId: agent.id,
    apiKey: apiKeyResult.key,
    apiKeyPrefix: apiKeyResult.prefix,
    walletAddress: agent.walletAddress,
    walletMode: agent.walletMode,
    erc8004AgentId: erc8004AgentId?.toString() || null,
    handle: agent.handle,
  };
}

export async function registerCustodialAgent(params: {
  privyToken: string;
  email?: string;
  handle?: string;
  description?: string;
  tags?: string[];
  skillTags?: string[];
  capabilities?: Record<string, unknown>;
  actorType?: "human" | "agent";
  webhookUrl?: string;
  mcpEndpoint?: string;
}) {
  // Verify Privy token
  const { privyId } = await verifyPrivyToken(params.privyToken);

  // Check for existing agent with this Privy ID
  const [existing] = await db
    .select()
    .from(agents)
    .where(eq(agents.privyUserId, privyId));
  if (existing) throw new Error("Agent already registered with this Privy account");

  // Get wallet address from Privy
  let walletAddress: string | null = null;
  try {
    walletAddress = await getPrivyUserWallet(privyId);
  } catch {
    // Wallet may not be created yet
  }

  const { key, prefix } = generateApiKey();
  const hash = await hashApiKey(key);

  // Register custodial agents on-chain too — they need ERC-8004 identity
  // for cross-platform reputation and discoverability
  const erc8004AgentId = await registerAndLinkOnChain(
    params.handle,
    walletAddress
  );

  const [agent] = await db
    .insert(agents)
    .values({
      walletAddress,
      walletMode: "custodial",
      privyUserId: privyId,
      email: params.email || null,
      handle: params.handle || null,
      description: params.description || null,
      tags: params.tags || [],
      skillTags: params.skillTags || [],
      capabilities: params.capabilities || {},
      actorType: params.actorType || "agent",
      webhookUrl: params.webhookUrl || null,
      mcpEndpoint: params.mcpEndpoint || null,
      apiKeyHash: hash,
      apiKeyPrefix: prefix,
      erc8004AgentId,
    })
    .returning();

  const apiKeyResult = await createApiKeyForAgent(agent.id, {
    label: "default",
    scopes: [...DEFAULT_SCOPES],
  });

  await initReputation(agent.id);

  return {
    agentId: agent.id,
    apiKey: apiKeyResult.key,
    apiKeyPrefix: apiKeyResult.prefix,
    walletAddress: agent.walletAddress,
    walletMode: agent.walletMode,
    erc8004AgentId: erc8004AgentId?.toString() || null,
    privyUserId: privyId,
    handle: agent.handle,
  };
}

// ── Lookup ──

export async function getAgentById(agentId: string) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId));
  return agent || null;
}

export async function getAgentPublicProfile(identifier: string) {
  const [agent] = await db
    .select({
      id: agents.id,
      handle: agents.handle,
      walletAddress: agents.walletAddress,
      walletMode: agents.walletMode,
      erc8004AgentId: agents.erc8004AgentId,
      description: agents.description,
      tags: agents.tags,
      skillTags: agents.skillTags,
      capabilities: agents.capabilities,
      actorType: agents.actorType,
      availabilityStatus: agents.availabilityStatus,
      webhookUrl: agents.webhookUrl,
      mcpEndpoint: agents.mcpEndpoint,
      createdAt: agents.createdAt,
    })
    .from(agents)
    .where(agentLookupCondition(identifier));

  if (!agent) return null;

  const [rep] = await db
    .select()
    .from(reputation)
    .where(eq(reputation.agentId, agent.id));

  // Read on-chain USDC balance
  const balance = await getAgentBalance(agent.id);

  const score = rep?.score ?? 0;
  const tierInfo = getTierForScore(score);

  // Read on-chain ERC-8004 reputation (best-effort)
  let onChainReputation: {
    feedback_count: string;
    avg_score: string;
    decimals: number;
  } | null = null;

  if (agent.erc8004AgentId) {
    try {
      const onChain = await getOnChainReputation(agent.erc8004AgentId);
      if (onChain) {
        onChainReputation = {
          feedback_count: onChain.count.toString(),
          avg_score: onChain.value.toString(),
          decimals: onChain.decimals,
        };
      }
    } catch {
      // On-chain read is best-effort
    }
  }

  return {
    ...agent,
    erc8004AgentId: agent.erc8004AgentId?.toString() || null,
    reputation: rep
      ? {
          score: rep.score,
          rollingScore: rep.rollingScore,
          stars: rep.stars,
          tier: tierInfo.tier,
          tier_label: tierInfo.label,
          perks: tierInfo.perks,
          completedJobs: rep.completedJobs,
          jobsPosted: rep.jobsPosted,
          totalEarned: rep.totalEarned,
          avgRating: rep.avgRating,
          totalReviews: rep.totalReviews,
        }
      : null,
    onChainReputation,
    balance,
    totalEarned: rep?.totalEarned || "0",
  };
}

// ── List ──

export async function listAgents(params: {
  search?: string;
  tag?: string;
  sort?: string;
  limit: number;
  offset: number;
}) {
  let query = db
    .select({
      id: agents.id,
      handle: agents.handle,
      walletAddress: agents.walletAddress,
      walletMode: agents.walletMode,
      description: agents.description,
      tags: agents.tags,
      skillTags: agents.skillTags,
      actorType: agents.actorType,
      availabilityStatus: agents.availabilityStatus,
      createdAt: agents.createdAt,
      score: reputation.score,
      stars: reputation.stars,
      completedJobs: reputation.completedJobs,
      totalEarned: reputation.totalEarned,
      avgRating: reputation.avgRating,
    })
    .from(agents)
    .leftJoin(reputation, eq(agents.id, reputation.agentId))
    .$dynamic();

  const conditions: SQL[] = [];

  if (params.search) {
    conditions.push(
      or(
        ilike(agents.handle, `%${params.search}%`),
        ilike(agents.description, `%${params.search}%`)
      )!
    );
  }

  if (params.tag) {
    // JSONB array containment: tags @> '["tag"]'::jsonb
    conditions.push(
      sql`${agents.tags}::jsonb @> ${JSON.stringify([params.tag])}::jsonb`
    );
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const orderBy =
    params.sort === "earned"
      ? desc(reputation.totalEarned)
      : params.sort === "score"
        ? desc(reputation.score)
        : params.sort === "rating"
          ? desc(reputation.avgRating)
          : desc(agents.createdAt);

  const rows = await query
    .orderBy(orderBy)
    .limit(params.limit)
    .offset(params.offset);

  return rows.map((r) => {
    const s = r.score ?? 0;
    const t = getTierForScore(s);
    return {
      id: r.id,
      handle: r.handle,
      walletAddress: r.walletAddress,
      walletMode: r.walletMode,
      description: r.description,
      tags: r.tags,
      skillTags: r.skillTags,
      actorType: r.actorType,
      availabilityStatus: r.availabilityStatus,
      createdAt: r.createdAt,
      reputation: {
        score: s,
        stars: r.stars ?? "0.0",
        tier: t.tier,
        tier_label: t.label,
        completedJobs: r.completedJobs ?? 0,
        totalEarned: r.totalEarned ?? "0",
        avgRating: r.avgRating ?? "0.0",
      },
    };
  });
}

// ── Update ──

export async function updateAgent(
  agentId: string,
  updates: {
    handle?: string;
    description?: string;
    tags?: string[];
    skillTags?: string[];
    capabilities?: Record<string, unknown>;
    availabilityStatus?: "online" | "offline" | "busy";
    webhookUrl?: string | null;
    webhookEvents?: string[] | null;
    mcpEndpoint?: string | null;
  }
) {
  const [agent] = await db
    .update(agents)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(agents.id, agentId))
    .returning();
  return agent;
}

// ── Key Rotation (Legacy) ──

export async function rotateApiKey(agentId: string) {
  const { key, prefix } = generateApiKey();
  const hash = await hashApiKey(key);

  await db
    .update(agents)
    .set({ apiKeyHash: hash, apiKeyPrefix: prefix, updatedAt: new Date() })
    .where(eq(agents.id, agentId));

  // Also deactivate all existing api_keys and create new one
  await db
    .update(apiKeys)
    .set({ isActive: false })
    .where(eq(apiKeys.agentId, agentId));

  const apiKeyResult = await createApiKeyForAgent(agentId, {
    label: "default",
    scopes: [...DEFAULT_SCOPES],
  });

  return { apiKey: apiKeyResult.key, apiKeyPrefix: apiKeyResult.prefix };
}
