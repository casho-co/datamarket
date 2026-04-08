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
      { name: "refId", type: "bytes32" },
      { name: "seller", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadlineHours", type: "uint256" },
      { name: "disputeWindowHours", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "cancelUnassigned",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "refId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "assignSeller",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "refId", type: "bytes32" },
      { name: "seller", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "assignSellerAndAdjust",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "refId", type: "bytes32" },
      { name: "seller", type: "address" },
      { name: "newAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "submitWork",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "refId", type: "bytes32" },
      { name: "deliverableHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "acceptDelivery",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "refId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "dispute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "refId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "release",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "refId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "refund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "refId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "resolveDispute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "refId", type: "bytes32" },
      { name: "releaseToSeller", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "resolveDisputeSplit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "refId", type: "bytes32" },
      { name: "sellerBps", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "isAutoReleaseReady",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "refId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isRefundReady",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "refId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getEscrow",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "refId", type: "bytes32" }],
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
          { name: "submittedAt", type: "uint256" },
          { name: "disputeWindowHours", type: "uint256" },
          { name: "deliverableHash", type: "bytes32" },
          { name: "state", type: "uint8" },
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
  SUBMITTED = 2,
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
  submittedAt: bigint;
  disputeWindowHours: bigint;
  deliverableHash: string;
  state: OnChainEscrowState;
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
 * Returns both approve and createEscrow TXes for the agent to sign.
 */
export function buildCreateEscrowData(params: {
  refId: string;
  seller: string;
  token: SupportedToken;
  amount: string;
  deadlineHours: number;
  disputeWindowHours: number;
}): { to: string; data: Hex; approveData: { to: string; data: Hex }; amountWei: string } {
  const tokenAddress = TOKEN_ADDRESSES[params.token];
  const amountWei = parseTokenAmount(params.amount, params.token);
  const contractAddr = getContractAddress();

  const data = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "createEscrow",
    args: [
      uuidToBytes32(params.refId),
      params.seller as Hex,
      tokenAddress as Hex,
      amountWei,
      BigInt(params.deadlineHours),
      BigInt(params.disputeWindowHours),
    ],
  });

  const approveData = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [contractAddr, amountWei],
  });

  return {
    to: contractAddr,
    data,
    approveData: { to: tokenAddress, data: approveData },
    amountWei: amountWei.toString(),
  };
}

/**
 * Build unsigned submitWork transaction data.
 */
export function buildSubmitWorkData(params: {
  refId: string;
  deliverableHash: string;
}): { to: string; data: Hex } {
  return {
    to: getContractAddress(),
    data: encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "submitWork",
      args: [uuidToBytes32(params.refId), params.deliverableHash as Hex],
    }),
  };
}

/**
 * Build unsigned dispute transaction data.
 */
export function buildDisputeData(refId: string): { to: string; data: Hex } {
  return {
    to: getContractAddress(),
    data: encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "dispute",
      args: [uuidToBytes32(refId)],
    }),
  };
}

/**
 * Build unsigned release transaction data.
 */
export function buildReleaseData(refId: string): { to: string; data: Hex } {
  return {
    to: getContractAddress(),
    data: encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "release",
      args: [uuidToBytes32(refId)],
    }),
  };
}

// ============ AGENT WALLET ESCROW (non-custodial) ============

/**
 * Build unsigned escrow transactions for the agent to sign locally.
 * Returns both approve and createEscrow TXes plus the exact amountWei.
 */
export function agentCreateEscrow(params: {
  walletAddress: string;
  refId: string;
  sellerAddress: string;
  token: SupportedToken;
  amount: string;
  deadlineHours: number;
  disputeWindowHours: number;
}): { unsignedTxs: { approve: { to: string; data: Hex }; createEscrow: { to: string; data: Hex } }; amountWei: string } {
  const txData = buildCreateEscrowData({
    refId: params.refId,
    seller: params.sellerAddress,
    token: params.token,
    amount: params.amount,
    deadlineHours: params.deadlineHours,
    disputeWindowHours: params.disputeWindowHours,
  });
  return {
    unsignedTxs: {
      approve: txData.approveData,
      createEscrow: { to: txData.to, data: txData.data },
    },
    amountWei: txData.amountWei,
  };
}

// ============ ORACLE EXECUTION (platform operations) ============

/**
 * Oracle assigns a seller to an escrow where seller was address(0).
 */
export async function oracleAssignSeller(
  entityId: string,
  sellerAddress: string
): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "assignSeller",
    args: [uuidToBytes32(entityId), sellerAddress as Hex],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Oracle assigns seller and adjusts amount atomically.
 * If newAmount < current amount, difference is refunded to buyer on-chain.
 */
export async function oracleAssignSellerAndAdjust(
  entityId: string,
  sellerAddress: string,
  newAmount: string,
  token: SupportedToken = "USDC"
): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();
  const amountWei = parseTokenAmount(newAmount, token);

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "assignSellerAndAdjust",
    args: [uuidToBytes32(entityId), sellerAddress as Hex, amountWei],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Oracle submits work on-chain (marks deliverable as submitted).
 */
export async function oracleSubmitWork(
  escrowId: string,
  deliverableHash: string
): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "submitWork",
    args: [uuidToBytes32(escrowId), deliverableHash as Hex],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Oracle accepts delivery on behalf of buyer — immediate release, no dispute window.
 */
export async function oracleAcceptDelivery(escrowId: string): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "acceptDelivery",
    args: [uuidToBytes32(escrowId)],
    account,
    chain: bsc,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Oracle auto-releases escrow (after dispute window — used by cron).
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
 * Oracle marks escrow as disputed on-chain.
 */
export async function oracleDispute(escrowId: string): Promise<string> {
  const walletClient = getWalletClient();
  const account = getPlatformAccount();
  const publicClient = getPublicClient();

  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "dispute",
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
 * Read on-chain escrow state by entity UUID (jobId, taskId, etc.).
 */
export async function getOnChainEscrow(entityId: string): Promise<OnChainEscrow> {
  const publicClient = getPublicClient();

  const result = await publicClient.readContract({
    address: getContractAddress(),
    abi: ESCROW_ABI,
    functionName: "getEscrow",
    args: [uuidToBytes32(entityId)],
  });

  const data = result as unknown as {
    buyer: string;
    seller: string;
    token: string;
    amount: bigint;
    createdAt: bigint;
    deadline: bigint;
    submittedAt: bigint;
    disputeWindowHours: bigint;
    deliverableHash: string;
    state: number;
  };

  return {
    buyer: data.buyer,
    seller: data.seller,
    token: data.token,
    amount: data.amount,
    createdAt: data.createdAt,
    deadline: data.deadline,
    submittedAt: data.submittedAt,
    disputeWindowHours: data.disputeWindowHours,
    deliverableHash: data.deliverableHash,
    state: data.state as OnChainEscrowState,
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
