export const BSC_CHAIN_ID = 56;
export const BSC_RPC_URL =
  process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/";

// USDC on BSC (BEP-20) — 18 decimals
export const USDC_BSC_ADDRESS =
  process.env.USDC_BSC_ADDRESS ||
  "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
export const USDC_DECIMALS = 18;

// USDT on BSC (BEP-20) — 18 decimals
export const USDT_BSC_ADDRESS =
  process.env.USDT_BSC_ADDRESS ||
  "0x55d398326f99059fF775485246999027B3197955";
export const USDT_DECIMALS = 18;

// Supported tokens
export const SUPPORTED_TOKENS = ["USDC", "USDT"] as const;
export type SupportedToken = (typeof SUPPORTED_TOKENS)[number];

export const TOKEN_ADDRESSES: Record<SupportedToken, string> = {
  USDC: USDC_BSC_ADDRESS,
  USDT: USDT_BSC_ADDRESS,
};

export const TOKEN_DECIMALS: Record<SupportedToken, number> = {
  USDC: USDC_DECIMALS,
  USDT: USDT_DECIMALS,
};

// ERC-8004 registries on BSC mainnet (CREATE2 deterministic addresses)
export const ERC8004_IDENTITY_REGISTRY =
  process.env.ERC8004_IDENTITY_REGISTRY ||
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const ERC8004_REPUTATION_REGISTRY =
  process.env.ERC8004_REPUTATION_REGISTRY ||
  "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";
export const ERC8004_VALIDATION_REGISTRY =
  process.env.ERC8004_VALIDATION_REGISTRY ||
  "0x8004Cb0000000000000000000000000000000000";

// Platform wallet
export const PLATFORM_BSC_ADDRESS = process.env.PLATFORM_BSC_ADDRESS || "";
export const PLATFORM_BSC_PRIVATE_KEY =
  process.env.PLATFORM_BSC_PRIVATE_KEY || "";

// Platform config
export const DISPUTE_DEPOSIT_BPS = 500; // 5%
export const RESOLVER_FEE_BPS = 200; // 2%
export const MIN_BALANCE_USDC = "1"; // 1 USDC to create jobs

// LiFi bridge API
export const LIFI_API_URL =
  process.env.LIFI_API_URL || "https://li.quest/v1";
export const LIFI_API_KEY = process.env.LIFI_API_KEY || "";

// Chain IDs for LiFi
export const CHAIN_IDS: Record<string, number> = {
  bsc: 56,
  ethereum: 1,
  arbitrum: 42161,
  polygon: 137,
  base: 8453,
};

// On-Chain Escrow Contracts (deployed via Foundry)
export const ESCROW_CONTRACT_ADDRESS =
  process.env.ESCROW_CONTRACT_ADDRESS || "";
export const REVENUE_MANAGER_ADDRESS =
  process.env.REVENUE_MANAGER_ADDRESS || "";
export const BUYBACK_HANDLER_ADDRESS =
  process.env.BUYBACK_HANDLER_ADDRESS || "";

// Escrow config
export const ESCROW_FEE_BPS = 100; // 1%
export const DEFAULT_DISPUTE_WINDOW_HOURS = 48;
export const DEFAULT_DEADLINE_HOURS = 168; // 7 days

// Sandbox mode
export const SANDBOX_MODE = process.env.SANDBOX_MODE === "true";
