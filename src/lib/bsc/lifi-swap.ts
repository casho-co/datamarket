import {
  LIFI_API_URL,
  LIFI_API_KEY,
  BSC_CHAIN_ID,
  CHAIN_IDS,
  PLATFORM_BSC_ADDRESS,
} from "./constants";

const LIFI_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  ...(LIFI_API_KEY ? { "x-lifi-api-key": LIFI_API_KEY } : {}),
};

// Native BNB address used by LiFi
const NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// ── Top BSC Tokens ──

export interface TopToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string | null;
  priceUSD: string | null;
}

/**
 * Fetch popular/top tokens on BSC via LiFi's token list API.
 */
export async function getTopBscTokens(): Promise<TopToken[]> {
  const res = await fetch(
    `${LIFI_API_URL}/tokens?chains=${BSC_CHAIN_ID}`,
    { headers: LIFI_HEADERS }
  );

  if (!res.ok) {
    throw new Error(`LiFi tokens API error: ${res.statusText}`);
  }

  const data = await res.json();
  const tokens = data.tokens?.[String(BSC_CHAIN_ID)] || [];

  return tokens.map(
    (t: {
      address: string;
      symbol: string;
      name: string;
      decimals: number;
      logoURI?: string;
      priceUSD?: string;
    }) => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      logoURI: t.logoURI || null,
      priceUSD: t.priceUSD || null,
    })
  );
}

// ── Token Info via LiFi ──

export async function getTokenInfoLifi(
  tokenAddress: string,
  chainId: number = BSC_CHAIN_ID
): Promise<TopToken | null> {
  const res = await fetch(
    `${LIFI_API_URL}/token?chain=${chainId}&token=${tokenAddress}`,
    { headers: LIFI_HEADERS }
  );

  if (!res.ok) return null;

  const t = await res.json();
  return {
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logoURI: t.logoURI || null,
    priceUSD: t.priceUSD || null,
  };
}

// ── Swap Quote ──

export interface SwapQuoteParams {
  fromToken: string; // token address or "BNB" for native
  toToken: string; // token address or "BNB" for native
  amount: string; // human-readable amount (e.g. "1.5")
  fromChain?: string; // chain name, defaults to "bsc"
  toChain?: string; // chain name, defaults to "bsc"
  fromAddress?: string; // wallet address, defaults to platform
  slippage?: number; // 0-1, defaults to 0.05 (5%)
}

export interface SwapQuote {
  fromToken: { symbol: string; address: string; decimals: number };
  toToken: { symbol: string; address: string; decimals: number };
  fromAmount: string;
  toAmount: string;
  toAmountHuman: string;
  estimatedGasUSD: string;
  estimatedTimeSeconds: number;
  tool: string;
  quoteData: Record<string, unknown>;
}

function resolveTokenAddress(token: string): string {
  if (
    token.toUpperCase() === "BNB" ||
    token.toUpperCase() === "NATIVE"
  ) {
    return NATIVE_TOKEN;
  }
  return token;
}

function resolveChainId(chain: string): number {
  const id = CHAIN_IDS[chain.toLowerCase()];
  if (!id) throw new Error(`Unsupported chain: ${chain}`);
  return id;
}

export async function getSwapQuote(
  params: SwapQuoteParams
): Promise<SwapQuote> {
  const fromChainId = resolveChainId(params.fromChain || "bsc");
  const toChainId = resolveChainId(params.toChain || "bsc");
  const fromTokenAddr = resolveTokenAddress(params.fromToken);
  const toTokenAddr = resolveTokenAddress(params.toToken);
  const fromAddress =
    params.fromAddress ||
    PLATFORM_BSC_ADDRESS ||
    "0x0000000000000000000000000000000000000000";
  const slippage = params.slippage ?? 0.05;

  // First resolve token info to get decimals for amount conversion
  const fromTokenInfo = await getTokenInfoLifi(fromTokenAddr, fromChainId);
  const decimals = fromTokenInfo?.decimals ?? 18;

  // Convert human amount to raw
  const [whole, fraction = ""] = params.amount.split(".");
  const paddedFraction = (fraction + "0".repeat(decimals)).slice(0, decimals);
  const amountRaw = (
    BigInt(whole) * BigInt("1" + "0".repeat(decimals)) +
    BigInt(paddedFraction)
  ).toString();

  const url = new URL(`${LIFI_API_URL}/quote`);
  url.searchParams.set("fromChain", fromChainId.toString());
  url.searchParams.set("toChain", toChainId.toString());
  url.searchParams.set("fromToken", fromTokenAddr);
  url.searchParams.set("toToken", toTokenAddr);
  url.searchParams.set("fromAmount", amountRaw);
  url.searchParams.set("fromAddress", fromAddress);
  url.searchParams.set("slippage", slippage.toString());
  url.searchParams.set("order", "RECOMMENDED");

  const res = await fetch(url.toString(), { headers: LIFI_HEADERS });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LiFi quote failed: ${err}`);
  }

  const quote = await res.json();

  const toDecimals = quote.action?.toToken?.decimals ?? 18;
  const toAmountRaw = quote.estimate?.toAmount || "0";
  const toAmountHuman = (
    parseFloat(toAmountRaw) /
    10 ** toDecimals
  ).toFixed(6);

  return {
    fromToken: {
      symbol: quote.action?.fromToken?.symbol || params.fromToken,
      address: quote.action?.fromToken?.address || fromTokenAddr,
      decimals: quote.action?.fromToken?.decimals || decimals,
    },
    toToken: {
      symbol: quote.action?.toToken?.symbol || params.toToken,
      address: quote.action?.toToken?.address || toTokenAddr,
      decimals: toDecimals,
    },
    fromAmount: params.amount,
    toAmount: toAmountRaw,
    toAmountHuman,
    estimatedGasUSD: quote.estimate?.gasCosts?.[0]?.amountUSD || "0",
    estimatedTimeSeconds: quote.estimate?.executionDuration || 0,
    tool: quote.toolDetails?.name || quote.tool || "unknown",
    quoteData: quote,
  };
}

// ── Execute Swap (returns transaction data for signing) ──

export interface SwapTxData {
  to: string;
  data: string;
  value: string;
  gasLimit: string;
  chainId: number;
}

/**
 * Get the unsigned transaction data to execute a swap.
 * The caller signs and broadcasts this transaction.
 * Uses LiFi's quote endpoint which includes transactionRequest.
 */
export async function getSwapTransaction(
  params: SwapQuoteParams
): Promise<{
  quote: SwapQuote;
  transactionRequest: SwapTxData;
}> {
  const fromChainId = resolveChainId(params.fromChain || "bsc");
  const toChainId = resolveChainId(params.toChain || "bsc");
  const fromTokenAddr = resolveTokenAddress(params.fromToken);
  const toTokenAddr = resolveTokenAddress(params.toToken);
  const fromAddress =
    params.fromAddress ||
    PLATFORM_BSC_ADDRESS ||
    "0x0000000000000000000000000000000000000000";
  const slippage = params.slippage ?? 0.05;

  // Resolve decimals
  const fromTokenInfo = await getTokenInfoLifi(fromTokenAddr, fromChainId);
  const decimals = fromTokenInfo?.decimals ?? 18;

  const [whole, fraction = ""] = params.amount.split(".");
  const paddedFraction = (fraction + "0".repeat(decimals)).slice(0, decimals);
  const amountRaw = (
    BigInt(whole) * BigInt("1" + "0".repeat(decimals)) +
    BigInt(paddedFraction)
  ).toString();

  const url = new URL(`${LIFI_API_URL}/quote`);
  url.searchParams.set("fromChain", fromChainId.toString());
  url.searchParams.set("toChain", toChainId.toString());
  url.searchParams.set("fromToken", fromTokenAddr);
  url.searchParams.set("toToken", toTokenAddr);
  url.searchParams.set("fromAmount", amountRaw);
  url.searchParams.set("fromAddress", fromAddress);
  url.searchParams.set("slippage", slippage.toString());
  url.searchParams.set("order", "RECOMMENDED");

  const res = await fetch(url.toString(), { headers: LIFI_HEADERS });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LiFi quote failed: ${err}`);
  }

  const quoteData = await res.json();

  if (!quoteData.transactionRequest) {
    throw new Error("Quote does not include transaction data");
  }

  const toDecimals = quoteData.action?.toToken?.decimals ?? 18;
  const toAmountRaw = quoteData.estimate?.toAmount || "0";
  const toAmountHuman = (
    parseFloat(toAmountRaw) /
    10 ** toDecimals
  ).toFixed(6);

  const quote: SwapQuote = {
    fromToken: {
      symbol: quoteData.action?.fromToken?.symbol || params.fromToken,
      address: quoteData.action?.fromToken?.address || fromTokenAddr,
      decimals: quoteData.action?.fromToken?.decimals || decimals,
    },
    toToken: {
      symbol: quoteData.action?.toToken?.symbol || params.toToken,
      address: quoteData.action?.toToken?.address || toTokenAddr,
      decimals: toDecimals,
    },
    fromAmount: params.amount,
    toAmount: toAmountRaw,
    toAmountHuman,
    estimatedGasUSD: quoteData.estimate?.gasCosts?.[0]?.amountUSD || "0",
    estimatedTimeSeconds: quoteData.estimate?.executionDuration || 0,
    tool: quoteData.toolDetails?.name || quoteData.tool || "unknown",
    quoteData,
  };

  const txReq = quoteData.transactionRequest;
  const transactionRequest: SwapTxData = {
    to: txReq.to,
    data: txReq.data,
    value: txReq.value || "0x0",
    gasLimit: txReq.gasLimit || txReq.gas || "0x55730",
    chainId: fromChainId,
  };

  return { quote, transactionRequest };
}

// ── Execute Swap via Platform Wallet (custodial) ──

export async function executeSwapCustodial(
  params: SwapQuoteParams
): Promise<{
  txHash: string;
  quote: SwapQuote;
  explorer: string;
}> {
  // Dynamically import viem to avoid circular deps
  const { getWalletClient, getPublicClient, getPlatformAccount } =
    await import("./client");

  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const account = getPlatformAccount();
  const { bsc } = await import("viem/chains");

  // Get quote with tx data using platform address
  const { quote, transactionRequest } = await getSwapTransaction({
    ...params,
    fromAddress: account.address,
  });

  const hash = await walletClient.sendTransaction({
    to: transactionRequest.to as `0x${string}`,
    data: transactionRequest.data as `0x${string}`,
    value: BigInt(transactionRequest.value),
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });

  return {
    txHash: hash,
    quote,
    explorer: `https://bscscan.com/tx/${hash}`,
  };
}
