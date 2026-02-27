import { db } from "@/lib/db";
import { favoriteAgents, agents, reputation } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function addFavorite(agentId: string, favoriteAgentId: string) {
  if (agentId === favoriteAgentId) {
    throw new Error("Cannot favorite yourself");
  }

  // Verify target agent exists
  const [target] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, favoriteAgentId));
  if (!target) throw new Error("Agent not found");

  const [fav] = await db
    .insert(favoriteAgents)
    .values({ agentId, favoriteAgentId })
    .onConflictDoNothing()
    .returning();

  return fav || { agent_id: agentId, favorite_agent_id: favoriteAgentId, already_exists: true };
}

export async function removeFavorite(agentId: string, favoriteAgentId: string) {
  const result = await db
    .delete(favoriteAgents)
    .where(
      and(
        eq(favoriteAgents.agentId, agentId),
        eq(favoriteAgents.favoriteAgentId, favoriteAgentId)
      )
    )
    .returning();

  if (result.length === 0) throw new Error("Favorite not found");
  return { removed: true };
}

export async function listFavorites(agentId: string, limit: number, offset: number) {
  const rows = await db
    .select({
      id: favoriteAgents.id,
      favoriteAgentId: favoriteAgents.favoriteAgentId,
      handle: agents.handle,
      description: agents.description,
      availabilityStatus: agents.availabilityStatus,
      score: reputation.score,
      createdAt: favoriteAgents.createdAt,
    })
    .from(favoriteAgents)
    .innerJoin(agents, eq(agents.id, favoriteAgents.favoriteAgentId))
    .leftJoin(reputation, eq(reputation.agentId, favoriteAgents.favoriteAgentId))
    .where(eq(favoriteAgents.agentId, agentId))
    .orderBy(desc(favoriteAgents.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}
