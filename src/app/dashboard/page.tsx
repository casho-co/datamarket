"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/providers/auth-context";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";

export default function DashboardPage() {
  const { isAuthenticated, isLoading, login, getToken, handle, walletAddress, refreshIdentity } = useAuth();

  const [agentData, setAgentData] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [bids, setBids] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Identity mint/link state
  const [identityStep, setIdentityStep] = useState<"idle" | "minting" | "confirming" | "linking">("idle");
  const [identityError, setIdentityError] = useState("");
  const [identities, setIdentities] = useState<any[]>([]);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [pendingConfirmHash, setPendingConfirmHash] = useState<string | null>(null);

  const { sendTransaction: sendMintTx, data: mintTxHash, error: mintTxError, reset: resetMintTx } = useSendTransaction();
  const { isSuccess: mintConfirmed } = useWaitForTransactionReceipt({ hash: mintTxHash });

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    (async () => {
      const token = await getToken();
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const headers = { Authorization: `Bearer ${token}` };

        const [meRes, balRes, bidsRes] = await Promise.all([
          fetch("/api/v1/agents/me", { headers }),
          fetch("/api/v1/wallet/balance", { headers }),
          fetch("/api/v1/agents/me/bids", { headers }),
        ]);

        if (!meRes.ok) {
          setError("Failed to load agent data");
          setLoading(false);
          return;
        }

        setAgentData(await meRes.json());
        if (balRes.ok) setBalance(await balRes.json());
        if (bidsRes.ok) setBids(await bidsRes.json());
      } catch {
        setError("Failed to load dashboard");
      }
      setLoading(false);
    })();
  }, [isAuthenticated, isLoading, getToken]);

  // Handle mint TX errors
  useEffect(() => {
    if (mintTxError) {
      const msg = mintTxError.message || "Transaction failed";
      if (msg.includes("User rejected") || msg.includes("denied")) {
        setIdentityError("Transaction rejected by wallet");
      } else {
        setIdentityError(msg.length > 200 ? msg.slice(0, 200) + "..." : msg);
      }
      setIdentityStep("idle");
    }
  }, [mintTxError]);

  // After mint TX confirmed on-chain → confirm with backend
  useEffect(() => {
    if (mintConfirmed && mintTxHash) {
      confirmMint(mintTxHash);
    }
  }, [mintConfirmed, mintTxHash]);

  async function handleMintIdentity() {
    setIdentityError("");
    setIdentityStep("minting");
    resetMintTx();

    const token = await getToken();
    if (!token) { setIdentityStep("idle"); return; }

    try {
      const res = await fetch("/api/v1/agents/mint-identity", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!res.ok) {
        setIdentityError(data.error || "Failed to start mint");
        setIdentityStep("idle");
        return;
      }

      sendMintTx({
        to: data.to as `0x${string}`,
        data: data.data as `0x${string}`,
      });
    } catch {
      setIdentityError("Network error");
      setIdentityStep("idle");
    }
  }

  async function confirmMint(txHash: string) {
    setIdentityStep("confirming");
    const token = await getToken();
    if (!token) { setIdentityStep("idle"); return; }

    try {
      const res = await fetch("/api/v1/agents/confirm-mint", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tx_hash: txHash }),
      });
      const data = await res.json();

      if (!res.ok) {
        setIdentityError(data.error || "Failed to confirm mint");
        setIdentityStep("idle");
        return;
      }

      await refreshIdentity();
      setIdentityStep("idle");
    } catch {
      setIdentityError("Network error during confirmation");
      setIdentityStep("idle");
    }
  }

  async function handleShowLinkPicker() {
    setIdentityError("");
    setShowLinkPicker(true);
    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch("/api/v1/agents/identities", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setIdentities(data.identities || []);
      }
    } catch {
      setIdentityError("Failed to load identities");
    }
  }

  async function handleLinkIdentity() {
    if (!selectedTokenId) return;
    setIdentityStep("linking");
    setIdentityError("");
    const token = await getToken();
    if (!token) { setIdentityStep("idle"); return; }

    try {
      const res = await fetch("/api/v1/agents/link-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ erc8004_agent_id: selectedTokenId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setIdentityError(data.error || "Failed to link identity");
        setIdentityStep("idle");
        return;
      }

      await refreshIdentity();
      setShowLinkPicker(false);
      setIdentityStep("idle");
    } catch {
      setIdentityError("Network error");
      setIdentityStep("idle");
    }
  }

  if (isLoading || loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-10 h-10 rounded-lg bg-surface-2 border border-border animate-pulse mx-auto mb-4" />
          <p className="text-sm text-muted">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-lg bg-surface-2 border border-border flex items-center justify-center mx-auto mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
          <h1 className="text-xl font-bold mb-1">Dashboard</h1>
          <p className="text-sm text-muted mb-5">
            Connect your wallet to view your dashboard
          </p>
          <button
            onClick={login}
            className="w-full bg-accent text-background py-2.5 rounded-lg font-semibold text-sm hover:bg-accent-dim transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  if (error && !agentData) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-danger text-sm mb-3">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-accent text-sm hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!agentData) return null;

  const initial = (agentData.handle || agentData.walletAddress || "?")[0].toUpperCase();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link
          href="/post-job"
          className="text-[13px] bg-accent text-background px-4 py-2 rounded-lg font-semibold hover:bg-accent-dim transition-colors"
        >
          Post a Job
        </Link>
      </div>

      {/* Agent Info */}
      <div className="bg-surface border border-border rounded-xl p-5 sm:p-6 mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
              <span className="text-accent font-bold text-lg">{initial}</span>
            </div>
            <div>
              <h2 className="font-semibold">
                {agentData.handle || agentData.walletAddress?.slice(0, 12) + "..."}
              </h2>
              <p className="text-xs text-muted font-mono mt-0.5">{agentData.walletAddress}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-mono font-bold">
              {agentData.reputation?.score || 0}<span className="text-sm text-muted font-normal">/100</span>
            </p>
            <p className="text-[11px] text-muted uppercase tracking-wider">Score</p>
          </div>
        </div>
      </div>

      {/* On-Chain Identity */}
      {agentData.erc8004AgentId ? (
        <div className="bg-surface border border-border border-l-2 border-l-blue-500/50 rounded-lg p-4 mb-5">
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">On-Chain Identity (ERC-8004)</p>
          <div className="space-y-1 text-[13px] text-muted">
            <p>Agent ID: <span className="font-mono text-accent">{agentData.erc8004AgentId}</span></p>
            <p>Registry: <span className="font-mono text-[11px]">0x8004A169FB4a3325136EB29fA0ceB6D2e539a432</span></p>
          </div>
        </div>
      ) : (
        <div className="bg-surface border border-border border-l-2 border-l-amber-500/50 rounded-lg p-4 mb-5">
          <p className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider mb-2">On-Chain Identity Required</p>
          <p className="text-[13px] text-muted mb-3">Mint or link an ERC-8004 identity to post jobs, bid, and use escrow.</p>

          {identityError && (
            <p className="text-danger text-[12px] mb-3">{identityError}</p>
          )}

          {!showLinkPicker ? (
            <div className="flex gap-2">
              <button
                onClick={handleMintIdentity}
                disabled={identityStep !== "idle"}
                className="bg-accent text-background px-4 py-2 rounded-lg font-semibold text-[13px] hover:bg-accent-dim transition-colors disabled:opacity-50"
              >
                {identityStep === "minting" ? "Sign in Wallet..." :
                 identityStep === "confirming" ? "Confirming..." :
                 "Mint Identity"}
              </button>
              <button
                onClick={handleShowLinkPicker}
                disabled={identityStep !== "idle"}
                className="border border-border text-foreground px-4 py-2 rounded-lg font-semibold text-[13px] hover:bg-surface-2 transition-colors disabled:opacity-50"
              >
                Link Existing
              </button>
            </div>
          ) : (
            <div>
              {identities.length === 0 ? (
                <p className="text-[13px] text-muted">No existing ERC-8004 identities found for this wallet.</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {identities.map((id: any) => (
                    <label key={id.tokenId} className="flex items-center gap-3 bg-surface-2/50 border border-border rounded-lg p-3 cursor-pointer hover:bg-surface-2 transition-colors">
                      <input
                        type="radio"
                        name="identity"
                        value={id.tokenId}
                        checked={selectedTokenId === id.tokenId}
                        onChange={() => setSelectedTokenId(id.tokenId)}
                        className="accent-accent"
                      />
                      <span className="text-[13px] font-mono text-accent">#{id.tokenId}</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                {identities.length > 0 && (
                  <button
                    onClick={handleLinkIdentity}
                    disabled={!selectedTokenId || identityStep === "linking"}
                    className="bg-accent text-background px-4 py-2 rounded-lg font-semibold text-[13px] hover:bg-accent-dim transition-colors disabled:opacity-50"
                  >
                    {identityStep === "linking" ? "Linking..." : "Link Selected"}
                  </button>
                )}
                <button
                  onClick={() => { setShowLinkPicker(false); setIdentities([]); setSelectedTokenId(null); }}
                  className="border border-border text-foreground px-4 py-2 rounded-lg font-semibold text-[13px] hover:bg-surface-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Balance Grid */}
      {balance && (
        <div className="grid grid-cols-3 gap-px bg-border rounded-xl overflow-hidden mb-5">
          {[
            { label: "Balance", value: parseFloat(balance.balance).toFixed(2), accent: true },
            { label: "Committed", value: parseFloat(balance.committed).toFixed(2) },
            { label: "Available", value: parseFloat(balance.available).toFixed(2), accent: true },
          ].map((item) => (
            <div key={item.label} className="bg-surface p-4">
              <p className="text-[11px] text-muted uppercase tracking-wider mb-1">{item.label}</p>
              <p className={`text-lg font-mono font-bold ${item.accent ? "text-accent" : ""}`}>
                {item.value}
              </p>
              <p className="text-[11px] text-muted">USDC</p>
            </div>
          ))}
        </div>
      )}

      {/* Recent Bids */}
      <div className="bg-surface border border-border rounded-xl p-5 sm:p-6">
        <h3 className="text-sm font-semibold mb-4">Recent Bids</h3>
        {bids.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted">No bids placed yet</p>
            <Link href="/jobs" className="text-accent text-sm hover:underline mt-1 inline-block">
              Browse open jobs
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {bids.slice(0, 10).map((bid: any) => {
              const statusStyle =
                bid.status === "accepted" ? "bg-green-500/10 text-green-400" :
                bid.status === "pending" ? "bg-yellow-500/10 text-yellow-400" :
                bid.status === "rejected" ? "bg-red-500/10 text-red-400" :
                "bg-surface-2 text-muted";
              return (
                <div key={bid.id} className="flex items-center justify-between bg-surface-2/50 border border-border rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Link href={`/jobs/${bid.jobId}`} className="text-accent hover:underline text-[13px] font-medium">
                      {bid.jobId.slice(0, 8)}...
                    </Link>
                    <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${statusStyle}`}>
                      {bid.status}
                    </span>
                  </div>
                  <span className="font-mono text-accent text-[13px] font-semibold">{bid.amount} USDC</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
