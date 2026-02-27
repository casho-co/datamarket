import { type Hex } from "viem";
import { bsc } from "viem/chains";
import { getPublicClient, getWalletClient, getPlatformAccount } from "./client";
import { REVENUE_MANAGER_ADDRESS } from "./constants";

const REVENUE_MANAGER_ABI = [
  {
    name: "distribute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
  {
    name: "distributeAll",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "getBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getRecipients",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "addr", type: "address" },
          { name: "shareBps", type: "uint256" },
          { name: "label", type: "string" },
        ],
      },
    ],
  },
  {
    name: "totalDistributed",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function getContractAddress(): Hex {
  if (!REVENUE_MANAGER_ADDRESS) {
    throw new Error("REVENUE_MANAGER_ADDRESS not configured");
  }
  return REVENUE_MANAGER_ADDRESS as Hex;
}

/**
 * Distribute accumulated fees for a specific token.
 */
export async function distributeRevenue(tokenAddress: string): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: REVENUE_MANAGER_ABI,
    functionName: "distribute",
    args: [tokenAddress as Hex],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Distribute all tracked tokens at once.
 */
export async function distributeAllRevenue(): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: REVENUE_MANAGER_ABI,
    functionName: "distributeAll",
    args: [],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Get balance of a token held by the revenue manager.
 */
export async function getRevenueBalance(tokenAddress: string): Promise<bigint> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: REVENUE_MANAGER_ABI,
    functionName: "getBalance",
    args: [tokenAddress as Hex],
  });

  return result as bigint;
}

/**
 * Get total distributed amount for a token.
 */
export async function getTotalDistributed(tokenAddress: string): Promise<bigint> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: REVENUE_MANAGER_ABI,
    functionName: "totalDistributed",
    args: [tokenAddress as Hex],
  });

  return result as bigint;
}

export interface RevenueRecipient {
  addr: string;
  shareBps: bigint;
  label: string;
}

/**
 * Get all configured recipients and their shares.
 */
export async function getRecipients(): Promise<RevenueRecipient[]> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: REVENUE_MANAGER_ABI,
    functionName: "getRecipients",
  });

  return (result as readonly { addr: string; shareBps: bigint; label: string }[]).map((r) => ({
    addr: r.addr,
    shareBps: r.shareBps,
    label: r.label,
  }));
}
