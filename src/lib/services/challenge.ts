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
): Promise<{
  nonce: string;
  expires_at: string;
  typed_data: {
    domain: typeof EIP712_DOMAIN;
    types: typeof CHALLENGE_TYPES;
    primaryType: "Challenge";
    message: {
      walletAddress: string;
      nonce: string;
      expiresAt: bigint;
      action: string;
    };
  };
}> {
  const redis = getRedis();
  const nonce = uuid();
  const expiresAtUnix = BigInt(Math.floor(Date.now() / 1000) + CHALLENGE_TTL);
  const key = `${CHALLENGE_PREFIX}${walletAddress.toLowerCase()}:${nonce}`;

  // Store action with nonce so we can verify it matches on verify
  await redis.set(key, action, { ex: CHALLENGE_TTL });

  const expiresAt = new Date(
    Date.now() + CHALLENGE_TTL * 1000
  ).toISOString();

  return {
    nonce,
    expires_at: expiresAt,
    typed_data: {
      domain: EIP712_DOMAIN,
      types: CHALLENGE_TYPES,
      primaryType: "Challenge",
      message: {
        walletAddress: walletAddress.toLowerCase() as Hex,
        nonce,
        expiresAt: expiresAtUnix,
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

  // Check nonce exists and get stored action
  const storedAction = await redis.get<string>(key);
  if (!storedAction) {
    return { valid: false, error: "Challenge expired or not found" };
  }

  // Verify action matches if specified
  if (expectedAction && storedAction !== expectedAction) {
    return {
      valid: false,
      error: `Challenge action mismatch. Expected: ${expectedAction}, got: ${storedAction}`,
    };
  }

  // Reconstruct the EIP-712 message and verify signature
  // We need the exact expiresAt from when the challenge was created.
  // Since Redis TTL gives us remaining time, we compute the original expiry.
  const ttl = await redis.ttl(key);
  const expiresAtUnix = BigInt(Math.floor(Date.now() / 1000) + ttl);

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
