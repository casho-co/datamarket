"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";

/** Decode JWT exp claim (no signature verification needed — server validates). */
function isTokenExpired(token: string): boolean {
  try {
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    if (!payload.exp) return false;
    // Give 30s grace window to avoid edge-case logouts mid-request
    return Date.now() / 1000 > payload.exp - 30;
  } catch {
    return true;
  }
}

interface AuthState {
  agentId: string | null;
  handle: string | null;
  walletAddress: string | null;
  accessToken: string | null;
  erc8004AgentId: string | null;
  hasOnChainIdentity: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Navigate to wallet connect / login page */
  login: () => void;
  /** Store session after wallet-based login completes */
  setSession: (token: string, agent: { agentId: string; handle: string | null; walletAddress: string; erc8004AgentId?: string | null }) => void;
  logout: () => void;
  getToken: () => Promise<string | null>;
  /** Re-fetch identity from server (call after mint/link) */
  refreshIdentity: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  agentId: null,
  handle: null,
  walletAddress: null,
  accessToken: null,
  erc8004AgentId: null,
  hasOnChainIdentity: false,
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  setSession: () => {},
  logout: () => {},
  getToken: async () => null,
  refreshIdentity: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const SESSION_KEY = "datalayer_session";

interface StoredSession {
  accessToken: string;
  agentId: string;
  handle: string | null;
  walletAddress: string;
  erc8004AgentId: string | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [erc8004AgentId, setErc8004AgentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session from localStorage on mount — skip if token is already expired
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) {
        const session: StoredSession = JSON.parse(stored);
        if (isTokenExpired(session.accessToken)) {
          localStorage.removeItem(SESSION_KEY);
        } else {
          setAccessToken(session.accessToken);
          setAgentId(session.agentId);
          setHandle(session.handle);
          setWalletAddress(session.walletAddress);
          setErc8004AgentId(session.erc8004AgentId ?? null);
        }
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(() => {
    router.push("/login");
  }, [router]);

  const setSession = useCallback(
    (token: string, agent: { agentId: string; handle: string | null; walletAddress: string; erc8004AgentId?: string | null }) => {
      setAccessToken(token);
      setAgentId(agent.agentId);
      setHandle(agent.handle);
      setWalletAddress(agent.walletAddress);
      setErc8004AgentId(agent.erc8004AgentId ?? null);

      const session: StoredSession = {
        accessToken: token,
        agentId: agent.agentId,
        handle: agent.handle,
        walletAddress: agent.walletAddress,
        erc8004AgentId: agent.erc8004AgentId ?? null,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    },
    []
  );

  const logout = useCallback(() => {
    setAccessToken(null);
    setAgentId(null);
    setHandle(null);
    setWalletAddress(null);
    setErc8004AgentId(null);
    localStorage.removeItem(SESSION_KEY);
    router.push("/");
  }, [router]);

  const getToken = useCallback(async () => {
    if (accessToken && isTokenExpired(accessToken)) {
      setAccessToken(null);
      setAgentId(null);
      setHandle(null);
      setWalletAddress(null);
      setErc8004AgentId(null);
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return accessToken;
  }, [accessToken]);

  const refreshIdentity = useCallback(async () => {
    if (!accessToken || isTokenExpired(accessToken)) return;
    try {
      const res = await fetch("/api/v1/agents/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const newId = data.erc8004AgentId?.toString() || null;
      setErc8004AgentId(newId);
      // Update localStorage
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) {
        const session: StoredSession = JSON.parse(stored);
        session.erc8004AgentId = newId;
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
    } catch {
      // Best-effort refresh
    }
  }, [accessToken]);

  return (
    <AuthContext.Provider
      value={{
        agentId,
        handle,
        walletAddress,
        accessToken,
        erc8004AgentId,
        hasOnChainIdentity: !!erc8004AgentId,
        isAuthenticated: !!accessToken && !!agentId && !isTokenExpired(accessToken),
        isLoading,
        login,
        setSession,
        logout,
        getToken,
        refreshIdentity,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
