// ── Four.meme Protocol Constants ──
// https://four-meme.gitbook.io/four.meme/brand/protocol-integration

export const FOUR_MEME_API_BASE =
  process.env.FOUR_MEME_API_BASE || "https://four.meme/meme-api/v1";

// TokenManager2 (Factory V2) — createToken, buyToken, sellToken
export const FOUR_MEME_FACTORY_V2 = "0x5c952063c7fc8610FFDB798152D69F0B9550762b";

// TokenManagerHelper3 — getTokenInfo, tryBuy, trySell, buyWithEth, sellForEth
export const FOUR_MEME_HELPER3 = "0xF251F83e40a78868FcfA3FA4599Dad6494E46034";

// WBNB
export const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

// Default token launch parameters
export const DEFAULT_TOTAL_SUPPLY = 1_000_000_000; // 1B tokens
export const DEFAULT_RAISED_AMOUNT = 24; // 24 BNB
export const DEFAULT_SALE_RATE = 0.8; // 80% for sale
export const DEFAULT_LP_TRADING_FEE = 0.0025; // 0.25% LP fee
export const DEFAULT_BUY_FEE = "0.01";
export const DEFAULT_SELL_FEE = "0.01";

// ── Four.meme API Headers ──

export const FOUR_MEME_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  origin: "https://four.meme",
  referer: "https://four.meme/",
} as const;

// ── TokenManager2 ABI (viem format) ──

export const FOUR_MEME_FACTORY_ABI = [
  {
    name: "buyTokenAMAP",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "funds", type: "uint256" },
      { name: "minAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "sellToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "createToken",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "args", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "_tokenInfos",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "base", type: "address" },
      { name: "quote", type: "address" },
      { name: "template", type: "uint256" },
      { name: "totalSupply", type: "uint256" },
      { name: "maxOffers", type: "uint256" },
      { name: "maxRaising", type: "uint256" },
      { name: "launchTime", type: "uint256" },
      { name: "offers", type: "uint256" },
      { name: "funds", type: "uint256" },
      { name: "lastPrice", type: "uint256" },
      { name: "K", type: "uint256" },
      { name: "T", type: "uint256" },
      { name: "status", type: "uint256" },
    ],
  },
  {
    name: "_tokenInfoEx1s",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "launchFee", type: "uint256" },
      { name: "pcFee", type: "uint256" },
      { name: "feeSetting", type: "uint256" },
      { name: "blockNumber", type: "uint256" },
      { name: "extraFee", type: "uint256" },
    ],
  },
  {
    name: "_launchFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // OwnershipTransferred event — used to extract token address from createToken receipt
  {
    name: "OwnershipTransferred",
    type: "event",
    inputs: [
      { name: "previousOwner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
    ],
  },
] as const;

// ── TokenManagerHelper3 ABI (viem format) ──

export const FOUR_MEME_HELPER3_ABI = [
  {
    name: "getTokenInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "version", type: "uint256" },
      { name: "tokenManager", type: "address" },
      { name: "quote", type: "address" },
      { name: "lastPrice", type: "uint256" },
      { name: "totalSupply", type: "uint256" },
      { name: "maxOffers", type: "uint256" },
      { name: "maxRaising", type: "uint256" },
      { name: "launchTime", type: "uint256" },
      { name: "offers", type: "uint256" },
      { name: "funds", type: "uint256" },
      { name: "K", type: "uint256" },
      { name: "T", type: "uint256" },
    ],
  },
  {
    name: "tryBuy",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "funds", type: "uint256" },
    ],
    outputs: [
      { name: "", type: "address" },
      { name: "", type: "address" },
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
      { name: "", type: "bool" },
    ],
  },
  {
    name: "trySell",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      { name: "", type: "address" },
      { name: "", type: "address" },
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
    ],
  },
  {
    name: "buyWithEth",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "origin", type: "uint256" },
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "funds", type: "uint256" },
      { name: "minAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "sellForEth",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "origin", type: "uint256" },
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "minFunds", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

// ── Standard ERC20 ABI (for approve/balanceOf) ──

export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
