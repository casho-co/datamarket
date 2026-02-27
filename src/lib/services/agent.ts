import { db } from "@/lib/db";
import { agents, reputation, agentWallets, apiKeys } from "@/lib/db/schema";
import { eq, ilike, or, desc, sql, and, type SQL } from "drizzle-orm";
import {
  generateApiKey,
  hashApiKey,
  createApiKeyForAgent,
} from "@/lib/auth/api-key";
import { registerAgentOnChain } from "@/lib/bsc/erc8004";
import { verifyPrivyToken, getPrivyUserWallet } from "@/lib/auth/privy";
import { DEFAULT_SCOPES } from "@/lib/auth/scopes";
import { initWallet } from "./wallet";
import { initReputation, getTierForScore } from "./reputation";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function agentLookupCondition(identifier: string): SQL {
  if (UUID_RE.test(identifier)) return eq(agents.id, identifier);
  return eq(agents.handle, identifier);
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

  // Register on-chain with ERC-8004
  let erc8004AgentId: bigint | null = null;
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || "https://datalayer-market.fly.dev";
    const agentURI = `${baseUrl}/api/v1/agents/${params.handle || params.walletAddress}`;
    erc8004AgentId = await registerAgentOnChain(agentURI);
  } catch {
    // On-chain registration may fail; continue
  }

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

  await initWallet(agent.id);
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
    })
    .returning();

  const apiKeyResult = await createApiKeyForAgent(agent.id, {
    label: "default",
    scopes: [...DEFAULT_SCOPES],
  });

  await initWallet(agent.id);
  await initReputation(agent.id);

  return {
    agentId: agent.id,
    apiKey: apiKeyResult.key,
    apiKeyPrefix: apiKeyResult.prefix,
    walletAddress: agent.walletAddress,
    walletMode: agent.walletMode,
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

  const [wallet] = await db
    .select({
      balance: agentWallets.balance,
      totalEarned: agentWallets.totalEarned,
    })
    .from(agentWallets)
    .where(eq(agentWallets.agentId, agent.id));

  const score = rep?.score ?? 0;
  const tierInfo = getTierForScore(score);

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
    balance: wallet?.balance || "0",
    totalEarned: wallet?.totalEarned || "0",
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
