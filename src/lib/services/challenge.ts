import { v4 as uuid } from "uuid";
import { verifyTypedData, type Hex } from "viem";
import { getRedis } from "@/lib/redis";
import { BSC_CHAIN_ID } from "@/lib/bsc/constants";

const CHALLENGE_TTL = 300; // 5 minutes
const CHALLENGE_PREFIX = "challenge:";

/**
 * EIP-712 domain for Datalayer Market challenges.
 */
const EIP712_DOMAIN = {
  name: "Datalayer Market",
  version: "1",
  chainId: BSC_CHAIN_ID,
} as const;

/**
 * EIP-712 types for the Challenge struct.
 */
const CHALLENGE_TYPES = {
  Challenge: [
    { name: "walletAddress", type: "address" },
    { name: "nonce", type: "string" },
    { name: "expiresAt", type: "uint256" },
    { name: "action", type: "string" },
  ],
} as const;

export type ChallengeAction = "register" | "login";

/**
 * Create an EIP-712 typed data challenge for a wallet address.
 * Stored in Redis with 5-min TTL.
 */
export async function createChallenge(
  walletAddress: string,
  action: ChallengeAction = "register"
) {
  const redis = getRedis();
  const nonce = uuid();
  const expiresAtUnix = Math.floor(Date.now() / 1000) + CHALLENGE_TTL;
  const key = `${CHALLENGE_PREFIX}${walletAddress.toLowerCase()}:${nonce}`;

  // Store action + original expiresAt — avoids reconstructing from TTL in verifyChallenge
  await redis.set(key, JSON.stringify({ action, expiresAt: String(expiresAtUnix) }), { ex: CHALLENGE_TTL });

  return {
    nonce,
    expires_at: new Date(expiresAtUnix * 1000).toISOString(),
    typed_data: {
      domain: EIP712_DOMAIN,
      types: CHALLENGE_TYPES,
      primaryType: "Challenge",
      message: {
        walletAddress: walletAddress.toLowerCase(),
        nonce,
        // Sent as string to avoid JSON.stringify BigInt crash — frontend converts to BigInt for signing
        expiresAt: String(expiresAtUnix),
        action,
      },
    },
  };
}

/**
 * Verify a signed EIP-712 challenge.
 * Returns true if:
 *   1. Nonce exists in Redis and hasn't expired
 *   2. EIP-712 signature recovers to the claimed wallet address
 *   3. Nonce is consumed (one-time use)
 */
export async function verifyChallenge(
  walletAddress: string,
  nonce: string,
  signature: string,
  expectedAction?: ChallengeAction
): Promise<{ valid: boolean; error?: string }> {
  const redis = getRedis();
  const key = `${CHALLENGE_PREFIX}${walletAddress.toLowerCase()}:${nonce}`;

  // Single Redis read — contains both action and original expiresAt
  const stored = await redis.get<string>(key);
  if (!stored) {
    return { valid: false, error: "Challenge expired or not found" };
  }

  let storedAction: string;
  let expiresAtUnix: bigint;
  try {
    const parsed = JSON.parse(stored) as { action: string; expiresAt: string };
    storedAction = parsed.action;
    expiresAtUnix = BigInt(parsed.expiresAt);
  } catch {
    // Legacy key stored as plain string (action only) — shouldn't exist after this deploy
    return { valid: false, error: "Challenge format invalid, please request a new challenge" };
  }

  // Verify action matches if specified
  if (expectedAction && storedAction !== expectedAction) {
    return {
      valid: false,
      error: `Challenge action mismatch. Expected: ${expectedAction}, got: ${storedAction}`,
    };
  }

  try {
    const valid = await verifyTypedData({
      address: walletAddress as Hex,
      domain: EIP712_DOMAIN,
      types: CHALLENGE_TYPES,
      primaryType: "Challenge",
      message: {
        walletAddress: walletAddress.toLowerCase() as Hex,
        nonce,
        expiresAt: expiresAtUnix,
        action: storedAction,
      },
      signature: signature as Hex,
    });

    if (!valid) {
      return {
        valid: false,
        error: "Signature does not match wallet address",
      };
    }
  } catch {
    return { valid: false, error: "Invalid signature format" };
  }

  // Consume nonce (one-time use)
  await redis.del(key);

  return { valid: true };
}
