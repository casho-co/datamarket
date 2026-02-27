import crypto from "crypto";
import bcryptjs from "bcryptjs";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { Scope } from "./scopes";
import { DEFAULT_SCOPES } from "./scopes";

const API_KEY_PREFIX = "sk_live_";

export function generateApiKey(): { key: string; prefix: string } {
  const randomBytes = crypto.randomBytes(32).toString("hex");
  const key = `${API_KEY_PREFIX}${randomBytes}`;
  const prefix = key.slice(0, 12);
  return { key, prefix };
}

export async function hashApiKey(key: string): Promise<string> {
  return bcryptjs.hash(key, 10);
}

export async function verifyApiKey(
  key: string,
  hash: string
): Promise<boolean> {
  return bcryptjs.compare(key, hash);
}

export async function createApiKeyForAgent(
  agentId: string,
  options?: { label?: string; scopes?: Scope[]; expiresAt?: Date }
): Promise<{ key: string; keyId: string; prefix: string }> {
  const { key, prefix } = generateApiKey();
  const hash = await hashApiKey(key);
  const scopes = options?.scopes ?? DEFAULT_SCOPES;

  const [record] = await db
    .insert(apiKeys)
    .values({
      agentId,
      keyHash: hash,
      keyPrefix: prefix,
      label: options?.label ?? "default",
      scopes,
      expiresAt: options?.expiresAt ?? null,
    })
    .returning({ id: apiKeys.id });

  return { key, keyId: record.id, prefix };
}

export async function revokeApiKey(
  agentId: string,
  keyId: string
): Promise<boolean> {
  const result = await db
    .update(apiKeys)
    .set({ isActive: false })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.agentId, agentId)))
    .returning({ id: apiKeys.id });
  return result.length > 0;
}

export async function listApiKeysForAgent(agentId: string) {
  return db
    .select({
      id: apiKeys.id,
      keyPrefix: apiKeys.keyPrefix,
      label: apiKeys.label,
      scopes: apiKeys.scopes,
      isActive: apiKeys.isActive,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.agentId, agentId));
}
