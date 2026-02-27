import type { Hex } from "viem";
import { parseEther, maxUint256, isAddress } from "viem";
import { bsc } from "viem/chains";
import { getPublicClient, getWalletClient, getPlatformAccount } from "./client";
import {
  FOUR_MEME_API_BASE,
  FOUR_MEME_FACTORY_V2,
  FOUR_MEME_HELPER3,
  FOUR_MEME_FACTORY_ABI,
  FOUR_MEME_HELPER3_ABI,
  FOUR_MEME_HEADERS,
  ERC20_ABI,
  WBNB_ADDRESS,
  DEFAULT_TOTAL_SUPPLY,
  DEFAULT_RAISED_AMOUNT,
  DEFAULT_SALE_RATE,
  DEFAULT_LP_TRADING_FEE,
  DEFAULT_BUY_FEE,
  DEFAULT_SELL_FEE,
} from "./fourmeme-constants";

// OwnershipTransferred event topic (keccak256)
const OWNERSHIP_TRANSFERRED_TOPIC =
  "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0" as const;

// ── Four.meme API Authentication ──

/**
 * Authenticate with Four.meme API.
 * Flow: getNonce → signMessage → login → returns accessToken
 */
async function getFourMemeAccessToken(): Promise<string> {
  const account = getPlatformAccount();
  const walletClient = getWalletClient();
  const userAddress = account.address;

  // Step 1: Get nonce
  const nonceRes = await fetch(
    `${FOUR_MEME_API_BASE}/private/user/nonce/generate`,
    {
      method: "POST",
      headers: FOUR_MEME_HEADERS,
      body: JSON.stringify({
        accountAddress: userAddress,
        verifyType: "LOGIN",
        networkCode: "BSC",
      }),
    }
  );
  const nonceData = await nonceRes.json();
  if (nonceData.code !== 0) {
    throw new Error(`Four.meme nonce error: ${nonceData.msg}`);
  }
  const nonce = nonceData.data;

  // Step 2: Sign message
  const message = `You are sign in Meme ${nonce}`;
  const signature = await walletClient.signMessage({
    account,
    message,
  });

  // Step 3: Login
  const loginRes = await fetch(
    `${FOUR_MEME_API_BASE}/private/user/login/dex`,
    {
      method: "POST",
      headers: FOUR_MEME_HEADERS,
      body: JSON.stringify({
        region: "WEB",
        langType: "EN",
        loginIp: "",
        inviteCode: "",
        walletName: "MetaMask",
        verifyInfo: {
          signature,
          address: userAddress,
          networkCode: "BSC",
          verifyType: "LOGIN",
        },
      }),
    }
  );
  const loginData = await loginRes.json();
  if (loginData.code !== 0) {
    throw new Error(`Four.meme login error: ${loginData.msg}`);
  }

  return loginData.data;
}

// ── Upload Image ──

async function uploadTokenImage(
  accessToken: string,
  imageUrl?: string
): Promise<string> {
  let imageBuffer: Buffer;

  if (imageUrl) {
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) throw new Error("Failed to fetch token image");
    imageBuffer = Buffer.from(await imageRes.arrayBuffer());
  } else {
    // Minimal 1x1 PNG placeholder
    imageBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==",
      "base64"
    );
  }

  // Build multipart/form-data manually
  const boundary = `----FormBoundary${Date.now()}`;
  const parts: Buffer[] = [];

  // File part
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="token.png"\r\nContent-Type: image/png\r\n\r\n`
    )
  );
  parts.push(imageBuffer);
  parts.push(Buffer.from("\r\n"));

  // networkCode part
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="networkCode"\r\n\r\nBSC\r\n`
    )
  );

  // End
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const uploadRes = await fetch(
    `${FOUR_MEME_API_BASE}/private/token/upload`,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "meme-web-access": accessToken,
        origin: "https://four.meme",
        referer: "https://four.meme/create-token",
      },
      body,
    }
  );
  const uploadData = await uploadRes.json();
  if (!uploadData.data) {
    throw new Error("Image upload returned empty URL");
  }
  return uploadData.data;
}

// ── Get Trending Tokens ──

export interface TrendingToken {
  address: string;
  name: string;
  symbol: string;
  image: string | null;
  status: number | null;
  price: string | null;
  marketCap: string | null;
  volume24h: string | null;
  priceChange24h: string | null;
  priceChange1h: string | null;
  liquidity: string | null;
  holders: number | null;
  progress: number | null;
  tradeUrl: string | null;
}

export async function getTrendingTokens(params?: {
  orderBy?: string;
  pageIndex?: number;
  pageSize?: number;
  listedPancake?: boolean;
}): Promise<TrendingToken[]> {
  const {
    orderBy = "MarketCapDesc",
    pageIndex = 1,
    pageSize = 20,
    listedPancake,
  } = params || {};

  const queryParams = new URLSearchParams({
    orderBy: String(orderBy),
    pageIndex: String(pageIndex),
    pageSize: String(pageSize),
  });
  if (listedPancake !== undefined) {
    queryParams.set("listedPancake", String(listedPancake));
  }

  const res = await fetch(
    `${FOUR_MEME_API_BASE}/private/token/query?${queryParams}`,
    { headers: FOUR_MEME_HEADERS }
  );
  const data = await res.json();

  if (data.code !== 0) {
    throw new Error(`Four.meme API error: ${data.msg}`);
  }

  const rawTokens = Array.isArray(data.data)
    ? data.data
    : data.data?.list || data.data?.records || [];

  return rawTokens.map((t: Record<string, unknown>) => {
    const tp = t.tokenPrice as Record<string, unknown> | undefined;
    return {
      address: t.address as string,
      name: t.name as string,
      symbol: (t.shortName || t.symbol) as string,
      image: (t.image as string) || null,
      status: t.status != null ? Number(t.status) : null,
      price: tp?.price != null ? String(tp.price) : null,
      marketCap: tp?.marketCap != null ? String(tp.marketCap) : null,
      volume24h: tp?.dayTrading != null ? String(tp.dayTrading) : null,
      priceChange24h: tp?.dayIncrease != null ? String(tp.dayIncrease) : null,
      priceChange1h: tp?.hourIncrease != null ? String(tp.hourIncrease) : null,
      liquidity: tp?.liquidity != null ? String(tp.liquidity) : null,
      holders: tp?.holderCount != null ? Number(tp.holderCount) : null,
      progress: tp?.progress != null ? Number(tp.progress) : null,
      tradeUrl: (t.tradeUrl as string) || null,
    };
  });
}

// ── Get Token Info (on-chain + API) ──

export interface TokenInfo {
  address: string;
  onChain: {
    base: string;
    quote: string;
    totalSupply: string;
    maxOffers: string;
    maxRaising: string;
    launchTime: string;
    offers: string;
    funds: string;
    lastPrice: string;
    status: number;
    version: number | null;
  };
  flags: {
    isTaxToken: boolean;
    isXMode: boolean;
    isAntiSniperFeeMode: boolean;
  };
  api: {
    name: string;
    symbol: string;
    description: string;
    image: string | null;
    price: string | null;
    marketCap: string | null;
  } | null;
}

export async function getTokenInfo(address: string): Promise<TokenInfo> {
  if (!address || !isAddress(address)) {
    throw new Error("Valid token address is required");
  }

  const client = getPublicClient();
  const TOKEN_TYPE_TAX = 5;

  const [helper3Info, rawInfo, extInfo, apiData] = await Promise.all([
    client
      .readContract({
        address: FOUR_MEME_HELPER3 as Hex,
        abi: FOUR_MEME_HELPER3_ABI,
        functionName: "getTokenInfo",
        args: [address as Hex],
      })
      .catch(() => null),
    client.readContract({
      address: FOUR_MEME_FACTORY_V2 as Hex,
      abi: FOUR_MEME_FACTORY_ABI,
      functionName: "_tokenInfos",
      args: [address as Hex],
    }),
    client
      .readContract({
        address: FOUR_MEME_FACTORY_V2 as Hex,
        abi: FOUR_MEME_FACTORY_ABI,
        functionName: "_tokenInfoEx1s",
        args: [address as Hex],
      })
      .catch(() => null),
    fetch(`${FOUR_MEME_API_BASE}/private/token/get?address=${address}`, {
      headers: FOUR_MEME_HEADERS,
    })
      .then((r) => r.json())
      .then((r) => r.data)
      .catch(() => null),
  ]);

  // _tokenInfos returns: (base, quote, template, totalSupply, maxOffers, maxRaising, launchTime, offers, funds, lastPrice, K, T, status)
  const info = rawInfo as unknown as readonly [string, string, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
  const [base, quote, template, totalSupply, maxOffers, maxRaising, launchTime, offers, funds, lastPrice, , , status] = info;

  // _tokenInfoEx1s returns: (launchFee, pcFee, feeSetting, blockNumber, extraFee)
  const ext = extInfo as unknown as readonly [bigint, bigint, bigint, bigint, bigint] | null;
  // getTokenInfo returns: (version, tokenManager, quote, lastPrice, ...)
  const h3 = helper3Info as unknown as readonly [bigint, ...unknown[]] | null;

  const templateNum = Number(template);
  const creatorType = (templateNum >> 10) & 0x3f;
  const isTaxToken = creatorType === TOKEN_TYPE_TAX;
  const isXMode = h3 ? Number(h3[0]) === 8 : false;
  const isAntiSniperFeeMode = ext ? Number(ext[2]) > 0 : false;

  return {
    address,
    onChain: {
      base: String(base),
      quote: String(quote),
      totalSupply: totalSupply.toString(),
      maxOffers: maxOffers.toString(),
      maxRaising: maxRaising.toString(),
      launchTime: launchTime.toString(),
      offers: offers.toString(),
      funds: funds.toString(),
      lastPrice: lastPrice.toString(),
      status: Number(status),
      version: h3 ? Number(h3[0]) : null,
    },
    flags: { isTaxToken, isXMode, isAntiSniperFeeMode },
    api: apiData
      ? {
          name: apiData.name,
          symbol: apiData.shortName || apiData.symbol,
          description: apiData.descr || apiData.description || "",
          image: apiData.image || null,
          price: apiData.tokenPrice?.price
            ? String(apiData.tokenPrice.price)
            : null,
          marketCap: apiData.marketCap ? String(apiData.marketCap) : null,
        }
      : null,
  };
}

// ── Launch Token ──

export interface LaunchTokenParams {
  name: string;
  symbol: string;
  description: string;
  imageUrl?: string;
  totalSupply?: number;
  raisedAmount?: number;
  initialBuyBnb?: string;
  label?: string;
  webUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
}

export interface LaunchTokenResult {
  txHash: string;
  tokenId: string | null;
  tokenAddress: string | null;
  explorer: string;
}

export async function launchToken(
  params: LaunchTokenParams
): Promise<LaunchTokenResult> {
  const {
    name,
    symbol,
    description,
    imageUrl,
    totalSupply = DEFAULT_TOTAL_SUPPLY,
    raisedAmount = DEFAULT_RAISED_AMOUNT,
    initialBuyBnb = "0",
    label = "Meme",
    webUrl,
    twitterUrl,
    telegramUrl,
  } = params;

  if (!name || !symbol || !description) {
    throw new Error("name, symbol, and description are required");
  }

  const walletClient = getWalletClient();
  const account = getPlatformAccount();

  // Step 1: Authenticate with Four.meme API
  const accessToken = await getFourMemeAccessToken();

  // Step 2: Upload image
  const imgUrl = await uploadTokenImage(accessToken, imageUrl);

  // Step 3: Call create token API to get signature
  const launchTime = Date.now();
  const createBody: Record<string, unknown> = {
    name,
    shortName: symbol,
    desc: description,
    totalSupply,
    raisedAmount,
    saleRate: DEFAULT_SALE_RATE,
    reserveRate: 0,
    imgUrl,
    lpTradingFee: DEFAULT_LP_TRADING_FEE,
    onlyMPC: false,
    feePlan: false,
    raisedToken: {
      symbol: "BNB",
      nativeSymbol: "BNB",
      symbolAddress: WBNB_ADDRESS.toLowerCase(),
      deployCost: "0",
      buyFee: DEFAULT_BUY_FEE,
      sellFee: DEFAULT_SELL_FEE,
      minTradeFee: "0",
      b0Amount: "8",
      totalBAmount: String(raisedAmount),
      totalAmount: String(totalSupply),
      saleRate: String(DEFAULT_SALE_RATE),
      networkCode: "BSC",
    },
    launchTime,
    preSale: initialBuyBnb,
    label,
    symbol: "BNB",
  };
  if (webUrl) createBody.webUrl = webUrl;
  if (twitterUrl) createBody.twitterUrl = twitterUrl;
  if (telegramUrl) createBody.telegramUrl = telegramUrl;

  const createRes = await fetch(
    `${FOUR_MEME_API_BASE}/private/token/create`,
    {
      method: "POST",
      headers: {
        ...FOUR_MEME_HEADERS,
        "meme-web-access": accessToken,
      },
      body: JSON.stringify(createBody),
    }
  );
  const createData = await createRes.json();

  if (createData.code !== 0) {
    throw new Error(
      `Four.meme create error: ${createData.msg || "Unknown error"}`
    );
  }

  const { createArg, signature: fourMemeSignature, tokenId } = createData.data;

  // Step 4: Get launch fee from contract
  const client = getPublicClient();
  const launchFee = (await client.readContract({
    address: FOUR_MEME_FACTORY_V2 as Hex,
    abi: FOUR_MEME_FACTORY_ABI,
    functionName: "_launchFee",
  })) as bigint;

  const buyValue = parseEther(String(initialBuyBnb || "0"));
  const totalValue = launchFee + buyValue;

  // Step 5: Call createToken on-chain
  const hash = await walletClient.writeContract({
    address: FOUR_MEME_FACTORY_V2 as Hex,
    abi: FOUR_MEME_FACTORY_ABI,
    functionName: "createToken",
    args: [createArg as Hex, fourMemeSignature as Hex],
    value: totalValue,
    account,
    chain: bsc,
    gas: BigInt(3_000_000),
  });

  const receipt = await client.waitForTransactionReceipt({ hash });

  // Extract token address from OwnershipTransferred event
  let tokenAddress: string | null = null;
  const ownershipLog = receipt.logs.find(
    (log) => log.topics[0] === OWNERSHIP_TRANSFERRED_TOPIC
  );
  if (ownershipLog) {
    tokenAddress = ownershipLog.address;
  }

  return {
    txHash: hash,
    tokenId: tokenId ? String(tokenId) : null,
    tokenAddress,
    explorer: `https://bscscan.com/tx/${hash}`,
  };
}

// ── Buy Token ──

export interface BuyTokenResult {
  txHash: string;
  explorer: string;
}

export async function buyToken(params: {
  tokenAddress: string;
  amountBnb: string;
  minTokens?: string;
}): Promise<BuyTokenResult> {
  if (!params.tokenAddress || !params.amountBnb) {
    throw new Error("tokenAddress and amountBnb are required");
  }

  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const client = getPublicClient();

  const bnbWei = parseEther(params.amountBnb);
  const minAmount = params.minTokens
    ? parseEther(params.minTokens)
    : BigInt(0);

  const hash = await walletClient.writeContract({
    address: FOUR_MEME_FACTORY_V2 as Hex,
    abi: FOUR_MEME_FACTORY_ABI,
    functionName: "buyTokenAMAP",
    args: [params.tokenAddress as Hex, bnbWei, minAmount],
    value: bnbWei,
    account,
    chain: bsc,
    gas: BigInt(350_000),
  });

  await client.waitForTransactionReceipt({ hash });

  return {
    txHash: hash,
    explorer: `https://bscscan.com/tx/${hash}`,
  };
}

// ── Sell Token ──

export interface SellTokenResult {
  txHash: string;
  explorer: string;
}

export async function sellToken(params: {
  tokenAddress: string;
  tokenAmount: string;
}): Promise<SellTokenResult> {
  if (!params.tokenAddress || !params.tokenAmount) {
    throw new Error("tokenAddress and tokenAmount are required");
  }

  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const client = getPublicClient();

  // Get token decimals
  const decimals = (await client.readContract({
    address: params.tokenAddress as Hex,
    abi: ERC20_ABI,
    functionName: "decimals",
  })) as number;

  const amount = BigInt(
    Math.floor(parseFloat(params.tokenAmount) * 10 ** decimals)
  );

  // Check allowance
  const allowance = (await client.readContract({
    address: params.tokenAddress as Hex,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, FOUR_MEME_FACTORY_V2 as Hex],
  })) as bigint;

  if (allowance < amount) {
    const approveHash = await walletClient.writeContract({
      address: params.tokenAddress as Hex,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [FOUR_MEME_FACTORY_V2 as Hex, maxUint256],
      account,
      chain: bsc,
      gas: BigInt(100_000),
    });
    await client.waitForTransactionReceipt({ hash: approveHash });
  }

  const hash = await walletClient.writeContract({
    address: FOUR_MEME_FACTORY_V2 as Hex,
    abi: FOUR_MEME_FACTORY_ABI,
    functionName: "sellToken",
    args: [params.tokenAddress as Hex, amount],
    account,
    chain: bsc,
    gas: BigInt(350_000),
  });

  await client.waitForTransactionReceipt({ hash });

  return {
    txHash: hash,
    explorer: `https://bscscan.com/tx/${hash}`,
  };
}
