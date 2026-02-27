import { PrivyClient } from "@privy-io/server-auth";

let privyClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient {
  if (!privyClient) {
    const appId = process.env.PRIVY_APP_ID?.trim();
    const appSecret = process.env.PRIVY_APP_SECRET?.trim();
    if (!appId || !appSecret) {
      throw new Error("PRIVY_APP_ID and PRIVY_APP_SECRET must be configured");
    }
    privyClient = new PrivyClient(appId, appSecret);
  }
  return privyClient;
}

export interface PrivyAuthResult {
  privyId: string;
  email?: string;
  walletAddress?: string;
}

export async function verifyPrivyToken(
  accessToken: string
): Promise<PrivyAuthResult> {
  const client = getPrivyClient();
  const verifiedClaims = await client.verifyAuthToken(accessToken);
  return {
    privyId: verifiedClaims.userId,
  };
}

export async function createPrivyWallet(
  privyUserId: string
): Promise<{ address: string }> {
  const client = getPrivyClient();
  const user = await client.getUser(privyUserId);

  const existing = user.linkedAccounts.find(
    (a) => a.type === "wallet" && a.walletClientType === "privy"
  );
  if (existing && "address" in existing) {
    return { address: existing.address as string };
  }

  // Privy embedded wallets are created on the client side;
  // server-side we can only retrieve existing ones.
  // If no wallet exists, the agent must complete client-side onboarding.
  throw new Error(
    "No embedded wallet found. Agent must complete Privy onboarding."
  );
}

export async function getPrivyUserWallet(
  privyUserId: string
): Promise<string | null> {
  const client = getPrivyClient();
  const user = await client.getUser(privyUserId);
  const wallet = user.linkedAccounts.find(
    (a) => a.type === "wallet" && a.walletClientType === "privy"
  );
  if (wallet && "address" in wallet) {
    return wallet.address as string;
  }
  return null;
}

/**
 * Send a transaction from a custodial agent's Privy embedded wallet.
 * Used for approve() and createEscrow() calls from the agent's own wallet.
 */
export async function sendTransactionFromPrivyWallet(params: {
  walletAddress: string;
  chainId: number;
  to: string;
  data: string;
}): Promise<string> {
  const client = getPrivyClient();
  const { hash } = await client.walletApi.ethereum.sendTransaction({
    address: params.walletAddress,
    chainType: "ethereum",
    caip2: `eip155:${params.chainId}`,
    transaction: {
      to: params.to as `0x${string}`,
      data: params.data as `0x${string}`,
    },
  });
  return hash;
}
