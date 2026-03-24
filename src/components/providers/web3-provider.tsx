"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RainbowKitProvider,
  RainbowKitAuthenticationProvider,
  createAuthenticationAdapter,
  darkTheme,
  type AuthenticationStatus,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createSiweMessage } from "viem/siwe";
import { config } from "@/lib/wagmi";
import { AuthProvider, useAuth } from "@/components/providers/auth-context";
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

function RainbowAuthWrapper({ children }: { children: React.ReactNode }) {
  const fetchingStatusRef = useRef(false);
  const verifyingRef = useRef(false);
  const [authStatus, setAuthStatus] = useState<AuthenticationStatus>("loading");
  const { setSession, logout, accessToken } = useAuth();

  // Check if user is already authenticated
  useEffect(() => {
    const fetchStatus = async () => {
      if (fetchingStatusRef.current || verifyingRef.current) return;
      fetchingStatusRef.current = true;

      try {
        if (!accessToken) {
          setAuthStatus("unauthenticated");
          return;
        }
        const response = await fetch("/api/siwe/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) {
          setAuthStatus("unauthenticated");
          return;
        }
        const json = await response.json();
        setAuthStatus(json.address ? "authenticated" : "unauthenticated");
      } catch {
        setAuthStatus("unauthenticated");
      } finally {
        fetchingStatusRef.current = false;
      }
    };

    fetchStatus();
    window.addEventListener("focus", fetchStatus);
    return () => window.removeEventListener("focus", fetchStatus);
  }, [accessToken]);

  // Stable refs so authAdapter doesn't get re-created on every route change
  const setSessionRef = useRef(setSession);
  setSessionRef.current = setSession;
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const authAdapter = useMemo(() => {
    return createAuthenticationAdapter({
      getNonce: async () => {
        const response = await fetch("/api/siwe/nonce");
        if (!response.ok) throw new Error("Failed to fetch nonce");
        return await response.text();
      },

      createMessage: ({ nonce, address, chainId }) => {
        return createSiweMessage({
          domain: window.location.host,
          address,
          statement: "Sign in to Datalayer Market to verify wallet ownership.",
          uri: window.location.origin,
          version: "1",
          chainId,
          nonce,
        });
      },

      verify: async ({ message, signature }) => {
        verifyingRef.current = true;
        try {
          const response = await fetch("/api/siwe/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, signature }),
          });

          if (!response.ok) {
            setAuthStatus("unauthenticated");
            return false;
          }

          const data = await response.json();
          if (data.ok && data.access_token) {
            setSessionRef.current(data.access_token, {
              agentId: data.agent_id,
              handle: data.handle,
              walletAddress: data.wallet_address,
              erc8004AgentId: data.erc8004_agent_id ?? null,
            });
            setAuthStatus("authenticated");
            return true;
          }

          setAuthStatus("unauthenticated");
          return false;
        } catch {
          setAuthStatus("unauthenticated");
          return false;
        } finally {
          verifyingRef.current = false;
        }
      },

      signOut: async () => {
        setAuthStatus("unauthenticated");
        logoutRef.current();
        await fetch("/api/siwe/logout");
      },
    });
  }, []); // stable — refs handle changing deps

  return (
    <RainbowKitAuthenticationProvider adapter={authAdapter} status={authStatus}>
      <RainbowKitProvider
        theme={darkTheme({
          accentColor: "#f59e0b",
          accentColorForeground: "#0a0a0a",
          borderRadius: "medium",
        })}
      >
        {children}
      </RainbowKitProvider>
    </RainbowKitAuthenticationProvider>
  );
}

/**
 * Full provider stack: Wagmi → React Query → Auth → RainbowKit (with SIWE adapter)
 */
export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RainbowAuthWrapper>{children}</RainbowAuthWrapper>
        </AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
