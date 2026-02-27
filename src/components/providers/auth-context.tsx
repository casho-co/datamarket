"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { usePrivy } from "@privy-io/react-auth";

interface AuthState {
  agentId: string | null;
  handle: string | null;
  walletAddress: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState>({
  agentId: null,
  handle: null,
  walletAddress: null,
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  logout: async () => {},
  getToken: async () => null,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const {
    ready,
    authenticated,
    login,
    logout: privyLogout,
    getAccessToken,
  } = usePrivy();

  const [agentId, setAgentId] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const syncAgent = useCallback(async () => {
    if (!authenticated) {
      setAgentId(null);
      setHandle(null);
      setWalletAddress(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const token = await getAccessToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      // Try to login (agent already registered)
      const loginRes = await fetch("/api/v1/agents/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privy_token: token }),
      });

      if (loginRes.ok) {
        const data = await loginRes.json();
        setAgentId(data.agent_id);
        setHandle(data.handle);
        setWalletAddress(data.wallet_address);
        setIsLoading(false);
        return;
      }

      // If 404, agent not registered — auto-register as human
      if (loginRes.status === 404) {
        const regRes = await fetch("/api/v1/agents/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "custodial",
            privy_token: token,
            actor_type: "human",
          }),
        });

        if (regRes.ok) {
          const data = await regRes.json();
          setAgentId(data.agent_id);
          setHandle(data.handle);
          setWalletAddress(data.wallet_address);
        }
      }
    } catch {
      // Auth sync failed silently
    }

    setIsLoading(false);
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    if (ready) {
      syncAgent();
    }
  }, [ready, authenticated, syncAgent]);

  const handleLogout = useCallback(async () => {
    await privyLogout();
    setAgentId(null);
    setHandle(null);
    setWalletAddress(null);
  }, [privyLogout]);

  const getToken = useCallback(async () => {
    if (!authenticated) return null;
    return getAccessToken();
  }, [authenticated, getAccessToken]);

  return (
    <AuthContext.Provider
      value={{
        agentId,
        handle,
        walletAddress,
        isAuthenticated: authenticated && !!agentId,
        isLoading: !ready || isLoading,
        login,
        logout: handleLogout,
        getToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
