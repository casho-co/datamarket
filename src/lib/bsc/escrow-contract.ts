import { type Hex, encodeFunctionData, keccak256, toHex, parseUnits, formatUnits } from "viem";
import { bsc } from "viem/chains";
import { getPublicClient, getWalletClient, getPlatformAccount } from "./client";
import {
  BSC_CHAIN_ID,
  ESCROW_CONTRACT_ADDRESS,
  USDC_DECIMALS,
  TOKEN_ADDRESSES,
  TOKEN_DECIMALS,
  type SupportedToken,
} from "./constants";

// ============ ABI ============

const ESCROW_ABI = [
  {
    name: "createEscrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrowId", type: "bytes32" },
      { name: "seller", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadlineHours", type: "uint256" },
      { name: "disputeWindowHours", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "markDelivered",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrowId", type: "bytes32" },
      { name: "deliverableHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "dispute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "release",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "refund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "resolveDispute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrowId", type: "bytes32" },
      { name: "releaseToSeller", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "resolveDisputeSplit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrowId", type: "bytes32" },
      { name: "sellerBps", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "isAutoReleaseReady",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isRefundReady",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getEscrow",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "buyer", type: "address" },
          { name: "seller", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "deliveredAt", type: "uint256" },
          { name: "disputeWindowHours", type: "uint256" },
          { name: "deliverableHash", type: "bytes32" },
          { name: "state", type: "uint8" },
          { name: "disputed", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "feeBasisPoints",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const ERC20_APPROVE_ABI = [
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
] as const;

// ============ ESCROW STATE ENUM ============

export enum OnChainEscrowState {
  NONE = 0,
  FUNDED = 1,
  DELIVERED = 2,
  DISPUTED = 3,
  RELEASED = 4,
  REFUNDED = 5,
}

export interface OnChainEscrow {
  buyer: string;
  seller: string;
  token: string;
  amount: bigint;
  createdAt: bigint;
  deadline: bigint;
  deliveredAt: bigint;
  disputeWindowHours: bigint;
  deliverableHash: string;
  state: OnChainEscrowState;
  disputed: boolean;
}

// ============ UTILITIES ============

/**
 * Convert a UUID string to bytes32 for smart contract compatibility.
 * Strips hyphens and pads to 32 bytes.
 */
export function uuidToBytes32(uuid: string): Hex {
  const hex = uuid.replace(/-/g, "");
  return ("0x" + hex.padEnd(64, "0")) as Hex;
}

/**
 * Hash deliverable content for on-chain proof (keccak256).
 */
export function hashDeliverable(content: string): Hex {
  return keccak256(toHex(content));
}

/**
 * Parse a human-readable token amount to wei (18 decimals on BSC).
 */
export function parseTokenAmount(amount: string, token: SupportedToken): bigint {
  return parseUnits(amount, TOKEN_DECIMALS[token]);
}

/**
 * Format a wei amount to human-readable (18 decimals on BSC).
 */
export function formatTokenAmount(amount: bigint, token: SupportedToken): string {
  return formatUnits(amount, TOKEN_DECIMALS[token]);
}

function getContractAddress(): Hex {
  if (!ESCROW_CONTRACT_ADDRESS) {
    throw new Error("ESCROW_CONTRACT_ADDRESS not configured");
  }
  return ESCROW_CONTRACT_ADDRESS as Hex;
}

// ============ BUILD TX DATA (for non-custodial agents) ============

/**
 * Build unsigned createEscrow transaction data.
 * Non-custodial agents sign this locally.
 */
export function buildCreateEscrowData(params: {
  escrowId: string;
  seller: string;
  token: SupportedToken;
  amount: string;
  deadlineHours: number;
  disputeWindowHours: number;
}): { to: string; data: Hex; approveData: { to: string; data: Hex } } {
  const tokenAddress = TOKEN_ADDRESSES[params.token];
  const amountWei = parseTokenAmount(params.amount, params.token);
  const contractAddr = getContractAddress();

  const data = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "createEscrow",
    args: [
      uuidToBytes32(params.escrowId),
      params.seller as Hex,
      tokenAddress as Hex,
      amountWei,
      BigInt(params.deadlineHours),
      BigInt(params.disputeWindowHours),
    ],
  });

  // Agent also needs to approve the escrow contract to spend tokens
  const approveData = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [contractAddr, amountWei],
  });

  return {
    to: contractAddr,
    data,
    approveData: { to: tokenAddress, data: approveData },
  };
}

/**
 * Build unsigned markDelivered transaction data.
 */
export function buildMarkDeliveredData(params: {
  escrowId: string;
  deliverableHash: string;
}): { to: string; data: Hex } {
  return {
    to: getContractAddress(),
    data: encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "markDelivered",
      args: [uuidToBytes32(params.escrowId), params.deliverableHash as Hex],
    }),
  };
}

/**
 * Build unsigned dispute transaction data.
 */
export function buildDisputeData(escrowId: string): { to: string; data: Hex } {
  return {
    to: getContractAddress(),
    data: encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "dispute",
      args: [uuidToBytes32(escrowId)],
    }),
  };
}

/**
 * Build unsigned release transaction data.
 */
export function buildReleaseData(escrowId: string): { to: string; data: Hex } {
  return {
    to: getContractAddress(),
    data: encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "release",
      args: [uuidToBytes32(escrowId)],
    }),
  };
}

// ============ AGENT WALLET ESCROW (non-custodial only) ============

/**
 * Build unsigned escrow transaction for the agent to sign locally.
 * All agents are non-custodial — they sign their own transactions.
 */
export function agentCreateEscrow(params: {
  walletAddress: string;
  escrowId: string;
  sellerAddress: string;
  token: SupportedToken;
  amount: string;
  deadlineHours: number;
  disputeWindowHours: number;
}): { unsignedTx: { approveData: { to: string; data: Hex }; to: string; data: Hex } } {
  const txData = buildCreateEscrowData({
    escrowId: params.escrowId,
    seller: params.sellerAddress,
    token: params.token,
    amount: params.amount,
    deadlineHours: params.deadlineHours,
    disputeWindowHours: params.disputeWindowHours,
  });
  return { unsignedTx: txData };
}

// ============ ORACLE EXECUTION (platform operations) ============

/**
 * Oracle creates an escrow on-chain. Platform wallet signs the tx.
 * For custodial agents: platform acts on behalf of the buyer.
 */
export async function oracleCreateEscrow(params: {
  escrowId: string;
  buyerAddress: string;
  sellerAddress: string;
  token: SupportedToken;
  amount: string;
  deadlineHours: number;
  disputeWindowHours: number;
}): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();
  const contractAddr = getContractAddress();
  const tokenAddress = TOKEN_ADDRESSES[params.token] as Hex;
  const amountWei = parseTokenAmount(params.amount, params.token);

  // Step 1: Approve escrow contract to spend tokens
  const approveHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [contractAddr, amountWei],
    account,
    chain: bsc,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  // Step 2: Create escrow
  const hash = await walletClient.writeContract({
    address: contractAddr,
    abi: ESCROW_ABI,
    functionName: "createEscrow",
    args: [
      uuidToBytes32(params.escrowId),
      params.sellerAddress as Hex,
      tokenAddress,
      amountWei,
      BigInt(params.deadlineHours),
      BigInt(params.disputeWindowHours),
    ],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Oracle marks delivery on-chain.
 */
export async function oracleMarkDelivered(
  escrowId: string,
  deliverableHash: string
): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "markDelivered",
    args: [uuidToBytes32(escrowId), deliverableHash as Hex],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Oracle releases escrow (after dispute window).
 */
export async function oracleRelease(escrowId: string): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "release",
    args: [uuidToBytes32(escrowId)],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Oracle refunds escrow.
 */
export async function oracleRefund(escrowId: string): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "refund",
    args: [uuidToBytes32(escrowId)],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Oracle resolves dispute (binary: release to seller or refund to buyer).
 */
export async function oracleResolveDispute(
  escrowId: string,
  releaseToSeller: boolean
): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "resolveDispute",
    args: [uuidToBytes32(escrowId), releaseToSeller],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Oracle resolves dispute with a split (basis points to seller).
 */
export async function oracleResolveDisputeSplit(
  escrowId: string,
  sellerBps: number
): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "resolveDisputeSplit",
    args: [uuidToBytes32(escrowId), BigInt(sellerBps)],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ============ VIEW FUNCTIONS ============

/**
 * Read on-chain escrow state.
 */
export async function getOnChainEscrow(escrowId: string): Promise<OnChainEscrow> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "getEscrow",
    args: [uuidToBytes32(escrowId)],
  });

  const data = result as unknown as {
    buyer: string;
    seller: string;
    token: string;
    amount: bigint;
    createdAt: bigint;
    deadline: bigint;
    deliveredAt: bigint;
    disputeWindowHours: bigint;
    deliverableHash: string;
    state: number;
    disputed: boolean;
  };

  return {
    buyer: data.buyer,
    seller: data.seller,
    token: data.token,
    amount: data.amount,
    createdAt: data.createdAt,
    deadline: data.deadline,
    deliveredAt: data.deliveredAt,
    disputeWindowHours: data.disputeWindowHours,
    deliverableHash: data.deliverableHash,
    state: data.state as OnChainEscrowState,
    disputed: data.disputed,
  };
}

/**
 * Check if auto-release is ready (for cron job).
 */
export async function checkAutoReleaseReady(escrowId: string): Promise<boolean> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "isAutoReleaseReady",
    args: [uuidToBytes32(escrowId)],
  });

  return result as boolean;
}

/**
 * Check if refund is ready (deadline passed).
 */
export async function checkRefundReady(escrowId: string): Promise<boolean> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "isRefundReady",
    args: [uuidToBytes32(escrowId)],
  });

  return result as boolean;
}

/**
 * Get current fee in basis points.
 */
export async function getFeeBasisPoints(): Promise<number> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "feeBasisPoints",
  });

  return Number(result);
}
