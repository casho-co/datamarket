import { type Hex, encodeFunctionData } from "viem";
import { bsc } from "viem/chains";
import { getPublicClient, getWalletClient, getPlatformAccount } from "./client";
import {
  ERC8004_IDENTITY_REGISTRY,
  ERC8004_REPUTATION_REGISTRY,
} from "./constants";

// ── ABIs ──

const IDENTITY_REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentURI", type: "string" },
      {
        name: "metadata",
        type: "tuple[]",
        components: [
          { name: "metadataKey", type: "string" },
          { name: "metadataValue", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "setMetadata",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "metadataKey", type: "string" },
      { name: "metadataValue", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "getAgentWallet",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Registered event for parsing agentId from logs
  {
    name: "Registered",
    type: "event",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
  // ERC-721 Transfer event
  {
    name: "Transfer",
    type: "event",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

const REPUTATION_REGISTRY_ABI = [
  {
    name: "giveFeedback",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "getSummary",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
  {
    name: "getClients",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
] as const;

// ERC-721 Transfer event topic (keccak256 of "Transfer(address,address,uint256)")
const TRANSFER_EVENT_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

// ── Identity Helpers ──

/**
 * Check how many ERC-8004 identity NFTs a wallet owns.
 * Used to prevent duplicate minting — if > 0, agent should link instead of mint.
 */
export async function getIdentityBalanceOf(walletAddress: string): Promise<bigint> {
  const client = getPublicClient();
  const balance = await client.readContract({
    address: ERC8004_IDENTITY_REGISTRY as Hex,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "balanceOf",
    args: [walletAddress as Hex],
  });
  return balance as bigint;
}

/**
 * Check who owns a specific ERC-8004 identity NFT.
 * Used to verify an agent actually owns the tokenId they claim.
 */
export async function getIdentityOwnerOf(tokenId: bigint): Promise<string> {
  const client = getPublicClient();
  const owner = await client.readContract({
    address: ERC8004_IDENTITY_REGISTRY as Hex,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  });
  return (owner as string).toLowerCase();
}

/**
 * Build unsigned transaction data for minting an ERC-8004 identity NFT.
 * Agent signs and submits this TX themselves — they become the owner.
 */
export function buildMintIdentityData(agentURI: string): { to: string; data: Hex } {
  const data = encodeFunctionData({
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "register",
    args: [agentURI],
  });
  return { to: ERC8004_IDENTITY_REGISTRY, data };
}

/**
 * Extract the minted tokenId from a transaction receipt's Transfer event.
 * Transfer(from=0x0, to=owner, tokenId) is emitted on mint.
 */
export function parseTokenIdFromReceipt(receipt: { logs: readonly { address: string; topics: readonly string[] }[] }): bigint | null {
  const transferLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === ERC8004_IDENTITY_REGISTRY.toLowerCase() &&
      log.topics[0] === TRANSFER_EVENT_TOPIC &&
      log.topics[1] === "0x0000000000000000000000000000000000000000000000000000000000000000"
  );
  if (transferLog && transferLog.topics[3]) {
    return BigInt(transferLog.topics[3]);
  }
  return null;
}

/**
 * List all ERC-8004 identity NFTs owned by a wallet.
 * Uses Registered event log scanning (works regardless of ERC-721 Enumerable support).
 */
export async function getIdentitiesForWallet(walletAddress: string): Promise<
  { tokenId: bigint; tokenURI: string; owner: string }[]
> {
  const client = getPublicClient();

  // Scan Registered events where owner = walletAddress
  const logs = await client.getLogs({
    address: ERC8004_IDENTITY_REGISTRY as Hex,
    event: {
      name: "Registered",
      type: "event",
      inputs: [
        { name: "agentId", type: "uint256", indexed: true },
        { name: "agentURI", type: "string", indexed: false },
        { name: "owner", type: "address", indexed: true },
      ],
    },
    args: { owner: walletAddress as Hex },
    fromBlock: BigInt(0),
    toBlock: "latest",
  });

  // For each registered identity, verify current ownership (may have been transferred)
  const results: { tokenId: bigint; tokenURI: string; owner: string }[] = [];
  for (const log of logs) {
    const tokenId = log.args.agentId!;
    try {
      const currentOwner = await getIdentityOwnerOf(tokenId);
      if (currentOwner === walletAddress.toLowerCase()) {
        const tokenURI = (await client.readContract({
          address: ERC8004_IDENTITY_REGISTRY as Hex,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "tokenURI",
          args: [tokenId],
        })) as string;
        results.push({ tokenId, tokenURI, owner: currentOwner });
      }
    } catch {
      // Token may not exist anymore, skip
    }
  }
  return results;
}



// ── Feedback ──

/**
 * Give on-chain reputation feedback for an agent.
 *
 * @param agentId - The on-chain ERC-8004 agent ID (uint256)
 * @param value - Feedback score (0-100 scale, or negative for penalties)
 * @param tag1 - Category: "job", "bounty", "task", "gig", "dispute"
 * @param tag2 - Outcome: "completed", "late", "lost", "abandoned"
 * @param feedbackURI - URL to the resource for verification (e.g., job/bounty page)
 * @param endpoint - Agent's API endpoint for discoverability
 */
export async function giveOnChainFeedback(params: {
  agentId: bigint;
  value: number;
  tag1: string;
  tag2: string;
  feedbackURI?: string;
  endpoint?: string;
}): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();

  const hash = await walletClient.writeContract({
    address: ERC8004_REPUTATION_REGISTRY as Hex,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "giveFeedback",
    args: [
      params.agentId,
      BigInt(params.value),
      0, // valueDecimals (whole numbers on 0-100 scale)
      params.tag1,
      params.tag2,
      params.endpoint || "",
      params.feedbackURI || "",
      "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
    ],
    account,
    chain: bsc,
  });

  const client = getPublicClient();
  await client.waitForTransactionReceipt({ hash });
  return hash;
}

// ── Read Reputation ──

/**
 * Get on-chain reputation summary for an agent.
 * First fetches all client addresses that have given feedback,
 * then calls getSummary() with those addresses (required for Sybil protection).
 */
export async function getOnChainReputation(
  agentId: bigint
): Promise<{ count: bigint; value: bigint; decimals: number } | null> {
  const client = getPublicClient();

  try {
    // Step 1: Get all client addresses that gave feedback to this agent
    const clients = (await client.readContract({
      address: ERC8004_REPUTATION_REGISTRY as Hex,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getClients",
      args: [agentId],
    })) as readonly Hex[];

    if (!clients || clients.length === 0) {
      return { count: BigInt(0), value: BigInt(0), decimals: 0 };
    }

    // Step 2: Get summary with actual client addresses
    const result = await client.readContract({
      address: ERC8004_REPUTATION_REGISTRY as Hex,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getSummary",
      args: [agentId, [...clients], "", ""],
    });
    const [count, value, decimals] = result as [bigint, bigint, number];
    return { count, value, decimals };
  } catch {
    return null;
  }
}
