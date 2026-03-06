import { parseUnits, formatUnits, type Hex } from "viem";
import { getPublicClient } from "./client";
import { USDC_BSC_ADDRESS, USDC_DECIMALS } from "./constants";

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export async function getUSDCBalance(address: string): Promise<string> {
  const client = getPublicClient();
  const balance = await client.readContract({
    address: USDC_BSC_ADDRESS as Hex,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address as Hex],
  });
  return formatUnits(balance as bigint, USDC_DECIMALS);
}

export function parseUSDC(amount: string): bigint {
  return parseUnits(amount, USDC_DECIMALS);
}

export function formatUSDC(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}
