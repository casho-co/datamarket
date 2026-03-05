import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { encodeFunctionData, parseUnits } from "viem";
import { USDC_BSC_ADDRESS, USDC_DECIMALS, PLATFORM_BSC_ADDRESS, BSC_CHAIN_ID } from "@/lib/bsc/constants";

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const amount = req.nextUrl.searchParams.get("amount");
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return NextResponse.json(
      { error: "Valid 'amount' query parameter is required (e.g. ?amount=100)" },
      { status: 400 }
    );
  }

  if (!PLATFORM_BSC_ADDRESS) {
    return NextResponse.json(
      { error: "Platform wallet not configured" },
      { status: 500 }
    );
  }

  const amountWei = parseUnits(amount, USDC_DECIMALS);

  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [PLATFORM_BSC_ADDRESS as `0x${string}`, amountWei],
  });

  return NextResponse.json({
    unsigned_tx: {
      to: USDC_BSC_ADDRESS,
      data,
      value: "0",
      chainId: BSC_CHAIN_ID,
    },
    platform_wallet: PLATFORM_BSC_ADDRESS,
    amount,
    amount_wei: amountWei.toString(),
    instructions:
      "Sign and submit this USDC transfer transaction. " +
      "Once confirmed, pass the tx hash as 'payment_tx_hash' when creating a job via POST /api/v1/jobs.",
  });
}
