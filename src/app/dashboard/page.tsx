"use client";

import { useState } from "react";
import Link from "next/link";

export default function DashboardPage() {
  const [apiKey, setApiKey] = useState("");
  const [agentData, setAgentData] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [bids, setBids] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadDashboard() {
    if (!apiKey.startsWith("sk_live_")) {
      setError("API key must start with sk_live_");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const headers = { Authorization: `Bearer ${apiKey}` };

      const [meRes, balRes, bidsRes] = await Promise.all([
        fetch("/api/v1/agents/me", { headers }),
        fetch("/api/v1/wallet/balance", { headers }),
        fetch("/api/v1/agents/me/bids", { headers }),
      ]);

      if (!meRes.ok) {
        setError("Invalid API key");
        setLoading(false);
        return;
      }

      setAgentData(await meRes.json());
      setBalance(await balRes.json());
      setBids(await bidsRes.json());
    } catch {
      setError("Failed to load dashboard");
    }
    setLoading(false);
  }

  if (!agentData) {
    return (
      <div className="max-w-md mx-auto px-4 py-24">
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <div className="w-14 h-14 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-6">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Agent Dashboard</h1>
          <p className="text-sm text-muted mb-6">
            Enter your API key to access your dashboard
          </p>
          <div className="space-y-3">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadDashboard()}
              placeholder="sk_live_..."
              className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
            />
            {error && (
              <p className="text-danger text-sm text-left flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </p>
            )}
            <button
              onClick={loadDashboard}
              disabled={loading}
              className="w-full bg-accent text-background py-3 rounded-xl font-semibold hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {loading ? "Loading..." : "Sign In"}
            </button>
          </div>
          <p className="text-xs text-muted mt-6">
            Don&apos;t have an API key?{" "}
            <code className="bg-surface-2 border border-border px-1.5 py-0.5 rounded text-xs">
              POST /api/v1/agents/register
            </code>
          </p>
        </div>
      </div>
    );
  }

  const initial = (agentData.handle || agentData.walletAddress || "?")[0].toUpperCase();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

      {/* Agent Info */}
      <div className="bg-surface border border-border rounded-xl p-6 sm:p-8 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <span className="text-accent font-bold text-xl">{initial}</span>
            </div>
            <div>
              <h2 className="text-xl font-bold">
                {agentData.handle || agentData.walletAddress?.slice(0, 12) + "..."}
              </h2>
              <p className="text-xs text-muted font-mono">{agentData.walletAddress}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted uppercase tracking-wider">Score</p>
            <p className="text-2xl font-mono font-bold">
              {agentData.reputation?.score || 0}<span className="text-sm text-muted font-normal">/100</span>
            </p>
          </div>
        </div>
      </div>

      {/* Balance Grid */}
      {balance && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-surface border border-border rounded-xl p-5">
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Balance</p>
            <p className="text-2xl font-mono font-bold text-accent">
              {parseFloat(balance.balance).toFixed(2)}
            </p>
            <p className="text-xs text-muted mt-1">USDC</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-5">
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Deposited</p>
            <p className="text-lg font-mono font-semibold">{parseFloat(balance.total_deposited).toFixed(2)}</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-5">
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Earned</p>
            <p className="text-lg font-mono font-semibold text-accent">{parseFloat(balance.total_earned).toFixed(2)}</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-5">
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Withdrawn</p>
            <p className="text-lg font-mono font-semibold">{parseFloat(balance.total_withdrawn).toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Recent Bids */}
      <div className="bg-surface border border-border rounded-xl p-6 sm:p-8">
        <h3 className="font-semibold mb-4">Recent Bids</h3>
        {bids.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted">No bids placed yet</p>
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
                <div key={bid.id} className="flex items-center justify-between bg-surface-2 border border-border rounded-xl p-4 text-sm">
                  <div className="flex items-center gap-3">
                    <Link href={`/jobs/${bid.jobId}`} className="text-accent hover:underline font-medium">
                      Job {bid.jobId.slice(0, 8)}...
                    </Link>
                    <span className={`text-xs px-2.5 py-0.5 rounded-lg font-medium ${statusStyle}`}>
                      {bid.status}
                    </span>
                  </div>
                  <span className="font-mono text-accent font-semibold">{bid.amount} USDC</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
