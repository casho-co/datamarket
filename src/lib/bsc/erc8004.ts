import type { Hex } from "viem";
import { bsc } from "viem/chains";
import { getPublicClient, getWalletClient, getPlatformAccount } from "./client";
import {
  ERC8004_IDENTITY_REGISTRY,
  ERC8004_REPUTATION_REGISTRY,
} from "./constants";

// Minimal ABIs for the functions we need

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
] as const;

export async function registerAgentOnChain(
  agentURI: string
): Promise<bigint> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();

  const hash = await walletClient.writeContract({
    address: ERC8004_IDENTITY_REGISTRY as Hex,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "register",
    args: [agentURI],
    account,
    chain: bsc,
  });

  const client = getPublicClient();
  const receipt = await client.waitForTransactionReceipt({ hash });

  // Parse Registered event to get agentId
  const registeredTopic =
    "0x" + "Registered".padEnd(64, "0"); // Not exact, parse from logs
  const transferLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() ===
      ERC8004_IDENTITY_REGISTRY.toLowerCase() &&
      log.topics[0] ===
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
  );

  if (transferLog && transferLog.topics[3]) {
    return BigInt(transferLog.topics[3]);
  }

  // Fallback: get balance - 1 as the latest token ID
  const balance = await client.readContract({
    address: ERC8004_IDENTITY_REGISTRY as Hex,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  return balance as bigint;
}

export async function getAgentOnChainInfo(agentId: bigint): Promise<{
  owner: string;
  tokenURI: string;
  wallet: string;
} | null> {
  const client = getPublicClient();
  try {
    const [owner, tokenURI, wallet] = await Promise.all([
      client.readContract({
        address: ERC8004_IDENTITY_REGISTRY as Hex,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "ownerOf",
        args: [agentId],
      }),
      client.readContract({
        address: ERC8004_IDENTITY_REGISTRY as Hex,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "tokenURI",
        args: [agentId],
      }),
      client.readContract({
        address: ERC8004_IDENTITY_REGISTRY as Hex,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "getAgentWallet",
        args: [agentId],
      }),
    ]);
    return {
      owner: owner as string,
      tokenURI: tokenURI as string,
      wallet: wallet as string,
    };
  } catch {
    return null;
  }
}

export async function giveOnChainFeedback(
  agentId: bigint,
  value: number,
  tag1: string,
  tag2: string
): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();

  const hash = await walletClient.writeContract({
    address: ERC8004_REPUTATION_REGISTRY as Hex,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "giveFeedback",
    args: [
      agentId,
      BigInt(value),
      0, // valueDecimals
      tag1,
      tag2,
      "", // endpoint
      "", // feedbackURI
      "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex, // feedbackHash
    ],
    account,
    chain: bsc,
  });

  const client = getPublicClient();
  await client.waitForTransactionReceipt({ hash });
  return hash;
}

export async function getOnChainReputation(
  agentId: bigint
): Promise<{ count: bigint; value: bigint; decimals: number }> {
  const client = getPublicClient();
  const result = await client.readContract({
    address: ERC8004_REPUTATION_REGISTRY as Hex,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "getSummary",
    args: [agentId, [], "", ""],
  });
  const [count, value, decimals] = result as [bigint, bigint, number];
  return { count, value, decimals };
}
