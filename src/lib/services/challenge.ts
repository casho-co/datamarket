import { v4 as uuid } from "uuid";
import { verifyMessage, type Hex } from "viem";
import { getRedis } from "@/lib/redis";

const CHALLENGE_TTL = 300; // 5 minutes
const CHALLENGE_PREFIX = "challenge:";

const SIGN_MESSAGE_DOMAIN = "Datalayer Market";

/**
 * Build the exact message agents must sign.
 */
export function buildSignMessage(nonce: string, walletAddress: string): string {
  return `${SIGN_MESSAGE_DOMAIN}\nRegister agent\nNonce: ${nonce}\nAddress: ${walletAddress}`;
}

/**
 * Create a challenge nonce for a wallet address.
 * Stored in Redis with 5-min TTL.
 */
export async function createChallenge(walletAddress: string): Promise<{
  nonce: string;
  message: string;
  expires_at: string;
}> {
  const redis = getRedis();
  const nonce = uuid();
  const key = `${CHALLENGE_PREFIX}${walletAddress.toLowerCase()}:${nonce}`;

  await redis.set(key, "1", { ex: CHALLENGE_TTL });

  const message = buildSignMessage(nonce, walletAddress);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL * 1000).toISOString();

  return { nonce, message, expires_at: expiresAt };
}

/**
 * Verify a signed challenge.
 * Returns true if:
 *   1. Nonce exists in Redis and hasn't expired
 *   2. Signature recovers to the claimed wallet address
 *   3. Nonce is consumed (one-time use)
 */
export async function verifyChallenge(
  walletAddress: string,
  nonce: string,
  signature: string
): Promise<{ valid: boolean; error?: string }> {
  const redis = getRedis();
  const key = `${CHALLENGE_PREFIX}${walletAddress.toLowerCase()}:${nonce}`;

  // Check nonce exists
  const exists = await redis.get(key);
  if (!exists) {
    return { valid: false, error: "Challenge expired or not found" };
  }

  // Reconstruct the message and verify signature
  const message = buildSignMessage(nonce, walletAddress);

  try {
    const recovered = await verifyMessage({
      address: walletAddress as Hex,
      message,
      signature: signature as Hex,
    });

    if (!recovered) {
      return { valid: false, error: "Signature does not match wallet address" };
    }
  } catch {
    return { valid: false, error: "Invalid signature format" };
  }

  // Consume nonce (one-time use)
  await redis.del(key);

  return { valid: true };
}
