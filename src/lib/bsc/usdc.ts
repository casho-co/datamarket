import { parseUnits, formatUnits, type Hex } from "viem";
import { bsc } from "viem/chains";
import { getPublicClient, getWalletClient, getPlatformAccount } from "./client";
import { USDC_BSC_ADDRESS, USDC_DECIMALS } from "./constants";

const ERC20_ABI = [
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
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
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

export async function transferUSDC(
  toAddress: string,
  amount: string
): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const amountWei = parseUnits(amount, USDC_DECIMALS);

  const hash = await walletClient.writeContract({
    address: USDC_BSC_ADDRESS as Hex,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [toAddress as Hex, amountWei],
    account,
    chain: bsc,
  });

  const client = getPublicClient();
  await client.waitForTransactionReceipt({ hash });
  return hash;
}

export async function verifyUSDCTransfer(
  txHash: string,
  expectedAmount: string,
  opts?: { expectedFrom?: string; expectedTo?: string }
): Promise<boolean> {
  const client = getPublicClient();
  try {
    const receipt = await client.getTransactionReceipt({
      hash: txHash as Hex,
    });
    if (receipt.status !== "success") return false;

    // Check logs for USDC Transfer event matching from/to/amount constraints
    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

    const expectedAmountWei = parseUnits(expectedAmount, USDC_DECIMALS);

    const relevantLog = receipt.logs.find((log) => {
      if (log.address.toLowerCase() !== USDC_BSC_ADDRESS.toLowerCase()) return false;
      if (log.topics[0] !== transferTopic) return false;

      // topics[1] = from address, topics[2] = to address
      if (opts?.expectedFrom) {
        const fromPadded = ("0x" + opts.expectedFrom.slice(2).padStart(64, "0")).toLowerCase();
        if (log.topics[1]?.toLowerCase() !== fromPadded) return false;
      }
      if (opts?.expectedTo) {
        const toPadded = ("0x" + opts.expectedTo.slice(2).padStart(64, "0")).toLowerCase();
        if (log.topics[2]?.toLowerCase() !== toPadded) return false;
      }

      // Verify the transfer amount in event data matches expected amount
      // ERC-20 Transfer data field contains the uint256 amount
      if (log.data) {
        const actualAmount = BigInt(log.data);
        if (actualAmount < expectedAmountWei) return false;
      } else {
        return false;
      }

      return true;
    });

    return !!relevantLog;
  } catch {
    return false;
  }
}

export function parseUSDC(amount: string): bigint {
  return parseUnits(amount, USDC_DECIMALS);
}

export function formatUSDC(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}
