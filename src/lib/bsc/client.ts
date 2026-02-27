import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { BSC_RPC_URL, PLATFORM_BSC_PRIVATE_KEY } from "./constants";

let _publicClient: PublicClient | null = null;
let _walletClient: WalletClient | null = null;

export function getPublicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: bsc as Chain,
      transport: http(BSC_RPC_URL),
    });
  }
  return _publicClient;
}

export function getWalletClient(): WalletClient {
  if (!_walletClient) {
    if (!PLATFORM_BSC_PRIVATE_KEY) {
      throw new Error("PLATFORM_BSC_PRIVATE_KEY not configured");
    }
    const account = privateKeyToAccount(
      PLATFORM_BSC_PRIVATE_KEY as `0x${string}`
    );
    _walletClient = createWalletClient({
      account,
      chain: bsc as Chain,
      transport: http(BSC_RPC_URL),
    });
  }
  return _walletClient;
}

export function getPlatformAccount() {
  if (!PLATFORM_BSC_PRIVATE_KEY) {
    throw new Error("PLATFORM_BSC_PRIVATE_KEY not configured");
  }
  return privateKeyToAccount(PLATFORM_BSC_PRIVATE_KEY as `0x${string}`);
}
