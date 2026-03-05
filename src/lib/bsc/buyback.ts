/**
 * Buyback-and-Burn Service
 *
 * When an agent with a launched token gets paid (escrow release),
 * a configurable % of the payment is used to:
 *   1. Swap USDC → agent token via PancakeSwap (LiFi aggregator)
 *   2. Burn the purchased tokens (send to 0xdead)
 *
 * Similar to Moltlaunch's BuybackBurned flow and Virtuals' agent token buyback.
 *
 * If the agent has no token, 100% goes directly to the worker (no buyback).
 */

import type { Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { bsc } from "viem/chains";
import { getPublicClient, getWalletClient, getPlatformAccount } from "./client";
import { getSwapTransaction } from "./lifi-swap";
import {
  USDC_BSC_ADDRESS,
  USDC_DECIMALS,
  BUYBACK_BPS,
  BUYBACK_MIN_USDC,
  BURN_ADDRESS,
  BUYBACK_SLIPPAGE,
} from "./constants";

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface BuybackResult {
  buybackAmount: string; // USDC amount used for buyback
  directAmount: string; // USDC amount sent directly to worker
  tokensBurned: string | null; // Agent tokens burned (null if swap failed)
  swapTxHash: string | null; // Swap transaction hash
  burnTxHash: string | null; // Burn transaction hash
  tokenAddress: string; // Agent's token address
}

/**
 * Calculate the buyback split for a payment amount.
 */
export function calculateBuybackSplit(totalAmount: string): {
  buybackAmount: string;
  directAmount: string;
} {
  const total = parseFloat(totalAmount);
  const buybackPortion = (total * BUYBACK_BPS) / 10_000;
  const directPortion = total - buybackPortion;

  return {
    buybackAmount: buybackPortion.toFixed(6),
    directAmount: directPortion.toFixed(6),
  };
}

/**
 * Execute a buyback-and-burn: swap USDC for the agent's token, then burn.
 *
 * Flow:
 *   1. Swap USDC → agent token via PancakeSwap (LiFi aggregator)
 *   2. Get the token balance received from the swap
 *   3. Transfer all received tokens to the burn address (0xdead)
 *
 * Uses the platform wallet for execution (custodial flow).
 * The escrow contract releases USDC to the platform wallet,
 * then platform wallet performs the buyback.
 */
export async function executeBuybackAndBurn(params: {
  usdcAmount: string;
  tokenAddress: string;
}): Promise<BuybackResult> {
  const { usdcAmount, tokenAddress } = params;

  // Skip buyback if amount is too small
  if (parseFloat(usdcAmount) < parseFloat(BUYBACK_MIN_USDC)) {
    return {
      buybackAmount: "0",
      directAmount: usdcAmount,
      tokensBurned: null,
      swapTxHash: null,
      burnTxHash: null,
      tokenAddress,
    };
  }

  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const account = getPlatformAccount();

  let swapTxHash: string | null = null;
  let burnTxHash: string | null = null;
  let tokensBurned: string | null = null;

  try {
    // Step 1: Get swap quote + tx data (USDC → agent token)
    const { quote, transactionRequest } = await getSwapTransaction({
      fromToken: USDC_BSC_ADDRESS,
      toToken: tokenAddress,
      amount: usdcAmount,
      fromChain: "bsc",
      toChain: "bsc",
      fromAddress: account.address,
      slippage: BUYBACK_SLIPPAGE,
    });

    // Step 2: Approve USDC spend if needed (LiFi handles this via the router)
    // Execute the swap
    const hash = await walletClient.sendTransaction({
      to: transactionRequest.to as Hex,
      data: transactionRequest.data as Hex,
      value: BigInt(transactionRequest.value),
      account,
      chain: bsc,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    swapTxHash = hash;

    // Step 3: Check how many agent tokens we received
    const tokenBalance = (await publicClient.readContract({
      address: tokenAddress as Hex,
      abi: ERC20_TRANSFER_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;

    if (tokenBalance > BigInt(0)) {
      // Step 4: Burn all received tokens by sending to dead address
      const burnHash = await walletClient.writeContract({
        address: tokenAddress as Hex,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [BURN_ADDRESS as Hex, tokenBalance],
        account,
        chain: bsc,
      });
      await publicClient.waitForTransactionReceipt({ hash: burnHash });
      burnTxHash = burnHash;

      // Format burned amount (try to get decimals, default to 18)
      try {
        const decimals = (await publicClient.readContract({
          address: tokenAddress as Hex,
          abi: [
            {
              name: "decimals",
              type: "function",
              stateMutability: "view",
              inputs: [],
              outputs: [{ name: "", type: "uint8" }],
            },
          ] as const,
          functionName: "decimals",
        })) as number;
        tokensBurned = formatUnits(tokenBalance, decimals);
      } catch {
        tokensBurned = formatUnits(tokenBalance, 18);
      }
    }

    return {
      buybackAmount: usdcAmount,
      directAmount: "0",
      tokensBurned,
      swapTxHash,
      burnTxHash,
      tokenAddress,
    };
  } catch (err) {
    // If buyback fails, return what we have — caller should handle fallback
    console.error(
      `Buyback failed for token ${tokenAddress}:`,
      err instanceof Error ? err.message : err
    );
    return {
      buybackAmount: "0",
      directAmount: usdcAmount, // Fallback: treat full amount as direct payment
      tokensBurned: null,
      swapTxHash,
      burnTxHash,
      tokenAddress,
    };
  }
}

/**
 * Process a payment with buyback-and-burn for agents with tokens.
 *
 * This is the main entry point called from the escrow release flow.
 *
 * @param workerAgentId - The agent receiving payment
 * @param totalAmount - Total USDC payment amount
 * @param tokenAddress - Agent's token address (from tokenLaunches table)
 * @returns BuybackResult with amounts and tx hashes
 */
export async function processPaymentWithBuyback(params: {
  totalAmount: string;
  tokenAddress: string;
}): Promise<BuybackResult> {
  const { totalAmount, tokenAddress } = params;

  // Calculate split
  const { buybackAmount, directAmount } = calculateBuybackSplit(totalAmount);

  // Execute the buyback portion
  const result = await executeBuybackAndBurn({
    usdcAmount: buybackAmount,
    tokenAddress,
  });

  // Update the direct amount (in case buyback failed and amount was reassigned)
  const actualDirectAmount =
    result.buybackAmount === "0"
      ? totalAmount // Full amount goes direct if buyback failed
      : directAmount;

  return {
    ...result,
    directAmount: actualDirectAmount,
  };
}
