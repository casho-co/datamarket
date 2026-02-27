"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { bsc } from "viem/chains";

export function PrivyProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    // Render children without Privy if not configured
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#f59e0b",
          logo: undefined,
        },
        loginMethods: ["email", "wallet", "google"],
        defaultChain: bsc,
        supportedChains: [bsc],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
