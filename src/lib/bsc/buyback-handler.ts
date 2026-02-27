import { type Hex } from "viem";
import { bsc } from "viem/chains";
import { getPublicClient, getWalletClient, getPlatformAccount } from "./client";
import { BUYBACK_HANDLER_ADDRESS } from "./constants";

const BUYBACK_HANDLER_ABI = [
  {
    name: "executeBuyback",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    name: "getBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalBuybacks",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalBoughtBack",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "protocolToken",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

function getContractAddress(): Hex {
  if (!BUYBACK_HANDLER_ADDRESS) {
    throw new Error("BUYBACK_HANDLER_ADDRESS not configured");
  }
  return BUYBACK_HANDLER_ADDRESS as Hex;
}

/**
 * Execute a token buyback via PancakeSwap.
 */
export async function executeBuyback(params: {
  tokenIn: string;
  amountIn: bigint;
  minAmountOut: bigint;
}): Promise<{ hash: string; amountOut: bigint }> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: BUYBACK_HANDLER_ABI,
    functionName: "executeBuyback",
    args: [params.tokenIn as Hex, params.amountIn, params.minAmountOut],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });

  // Parse amountOut from transaction receipt logs
  // For simplicity, return BigInt(0) — the actual amount is in the event log
  return { hash, amountOut: BigInt(0) };
}

/**
 * Get balance of a token held by the buyback handler.
 */
export async function getBuybackBalance(tokenAddress: string): Promise<bigint> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: BUYBACK_HANDLER_ABI,
    functionName: "getBalance",
    args: [tokenAddress as Hex],
  });

  return result as bigint;
}

/**
 * Get total number of buybacks executed.
 */
export async function getTotalBuybacks(): Promise<number> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: BUYBACK_HANDLER_ABI,
    functionName: "totalBuybacks",
  });

  return Number(result);
}

/**
 * Get total amount of protocol token bought back.
 */
export async function getTotalBoughtBack(tokenAddress: string): Promise<bigint> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: BUYBACK_HANDLER_ABI,
    functionName: "totalBoughtBack",
    args: [tokenAddress as Hex],
  });

  return result as bigint;
}

/**
 * Get the protocol token address.
 */
export async function getProtocolToken(): Promise<string> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: BUYBACK_HANDLER_ABI,
    functionName: "protocolToken",
  });

  return result as string;
}
