import { db } from "@/lib/db";
import {
  crossChainDeposits,
  lifiBridgeTransactions,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  LIFI_API_URL,
  LIFI_API_KEY,
  CHAIN_IDS,
  TOKEN_ADDRESSES,
  PLATFORM_BSC_ADDRESS,
  type SupportedToken,
} from "@/lib/bsc/constants";
// Note: creditBalance removed — agents hold USDC in their own wallets

const LIFI_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  ...(LIFI_API_KEY ? { "x-lifi-api-key": LIFI_API_KEY } : {}),
};

export async function getCrossChainQuote(params: {
  agentId: string;
  sourceChain: string;
  sourceToken: string;
  amount: string;
  destinationToken: SupportedToken;
}) {
  const fromChainId = CHAIN_IDS[params.sourceChain];
  if (!fromChainId) throw new Error(`Unsupported source chain: ${params.sourceChain}`);

  const toChainId = CHAIN_IDS.bsc;
  const toToken = TOKEN_ADDRESSES[params.destinationToken];

  // Convert amount to raw units (18 decimals for most stablecoins)
  const amountRaw = BigInt(Math.floor(parseFloat(params.amount) * 1e18)).toString();

  const url = new URL(`${LIFI_API_URL}/quote`);
  url.searchParams.set("fromChain", fromChainId.toString());
  url.searchParams.set("toChain", toChainId.toString());
  url.searchParams.set("fromToken", params.sourceToken);
  url.searchParams.set("toToken", toToken);
  url.searchParams.set("fromAmount", amountRaw);
  url.searchParams.set("fromAddress", PLATFORM_BSC_ADDRESS || "0x0000000000000000000000000000000000000000");

  const response = await fetch(url.toString(), { headers: LIFI_HEADERS });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LiFi quote failed: ${err}`);
  }

  const quote = await response.json();

  return {
    source_chain: params.sourceChain,
    source_token: params.sourceToken,
    destination_chain: "bsc",
    destination_token: params.destinationToken,
    from_amount: params.amount,
    estimated_receive: quote.estimate?.toAmount
      ? (parseFloat(quote.estimate.toAmount) / 1e18).toFixed(6)
      : params.amount,
    estimated_gas: quote.estimate?.gasCosts?.[0]?.amountUSD || "0",
    estimated_time_seconds: quote.estimate?.executionDuration || 0,
    tool: quote.toolDetails?.name || quote.tool || "unknown",
    quote_id: quote.id || null,
  };
}

export async function recordCrossChainDeposit(params: {
  agentId: string;
  sourceChain: string;
  sourceTxHash: string;
  amount: string;
  lifiTransactionId?: string;
  token: SupportedToken;
}) {
  // Create cross-chain deposit record
  const [deposit] = await db
    .insert(crossChainDeposits)
    .values({
      agentId: params.agentId,
      sourceChain: params.sourceChain as "ethereum" | "arbitrum" | "polygon" | "base",
      sourceTxHash: params.sourceTxHash,
      amount: params.amount,
      status: "pending",
    })
    .returning();

  // Create LiFi bridge transaction record
  const [lifiTx] = await db
    .insert(lifiBridgeTransactions)
    .values({
      agentId: params.agentId,
      crossChainDepositId: deposit.id,
      lifiTransactionId: params.lifiTransactionId || null,
      sourceChain: params.sourceChain as "ethereum" | "arbitrum" | "polygon" | "base",
      sourceToken: params.token,
      sourceAmount: params.amount,
      destinationToken: TOKEN_ADDRESSES[params.token],
      status: "pending",
    })
    .returning();

  return {
    deposit_id: deposit.id,
    lifi_transaction_id: lifiTx.id,
    source_chain: params.sourceChain,
    amount: params.amount,
    token: params.token,
    status: "pending",
    message: "Cross-chain deposit recorded. Funds will be credited after bridge confirmation.",
  };
}

export async function checkBridgeStatus(lifiTransactionId: string) {
  const url = `${LIFI_API_URL}/status?txHash=${lifiTransactionId}`;
  const response = await fetch(url, { headers: LIFI_HEADERS });

  if (!response.ok) {
    return { status: "unknown", message: "Could not check bridge status" };
  }

  const data = await response.json();
  return {
    status: data.status || "unknown",
    substatus: data.substatus || null,
    sending_tx: data.sending?.txHash || null,
    receiving_tx: data.receiving?.txHash || null,
  };
}

export async function confirmCrossChainDeposit(depositId: string) {
  const [deposit] = await db
    .select()
    .from(crossChainDeposits)
    .where(eq(crossChainDeposits.id, depositId));

  if (!deposit) throw new Error("Deposit not found");
  if (deposit.status === "confirmed") throw new Error("Already confirmed");

  await db
    .update(crossChainDeposits)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(eq(crossChainDeposits.id, depositId));

  // No off-chain balance to credit — bridge funds arrive directly in agent's wallet on BSC

  // Update LiFi transaction
  await db
    .update(lifiBridgeTransactions)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(lifiBridgeTransactions.crossChainDepositId, depositId));

  return { deposit_id: depositId, status: "confirmed", amount: deposit.amount };
}

export async function listCrossChainDeposits(agentId: string, limit: number, offset: number) {
  return db
    .select()
    .from(crossChainDeposits)
    .where(eq(crossChainDeposits.agentId, agentId))
    .orderBy(desc(crossChainDeposits.createdAt))
    .limit(limit)
    .offset(offset);
}
