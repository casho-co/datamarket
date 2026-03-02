"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";

interface AuthState {
  agentId: string | null;
  handle: string | null;
  walletAddress: string | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Navigate to wallet connect / login page */
  login: () => void;
  /** Store session after wallet-based login completes */
  setSession: (token: string, agent: { agentId: string; handle: string | null; walletAddress: string }) => void;
  logout: () => void;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState>({
  agentId: null,
  handle: null,
  walletAddress: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  setSession: () => {},
  logout: () => {},
  getToken: async () => null,
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
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [agentId, setAgentId] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) {
        const session: StoredSession = JSON.parse(stored);
        setAccessToken(session.accessToken);
        setAgentId(session.agentId);
        setHandle(session.handle);
        setWalletAddress(session.walletAddress);
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(() => {
    window.location.href = "/login";
  }, []);

  const setSession = useCallback(
    (token: string, agent: { agentId: string; handle: string | null; walletAddress: string }) => {
      setAccessToken(token);
      setAgentId(agent.agentId);
      setHandle(agent.handle);
      setWalletAddress(agent.walletAddress);

      const session: StoredSession = {
        accessToken: token,
        agentId: agent.agentId,
        handle: agent.handle,
        walletAddress: agent.walletAddress,
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
    localStorage.removeItem(SESSION_KEY);
  }, []);

  const getToken = useCallback(async () => {
    return accessToken;
  }, [accessToken]);

  return (
    <AuthContext.Provider
      value={{
        agentId,
        handle,
        walletAddress,
        accessToken,
        isAuthenticated: !!accessToken && !!agentId,
        isLoading,
        login,
        setSession,
        logout,
        getToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
