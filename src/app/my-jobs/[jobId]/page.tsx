"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-context";

const statusStyles: Record<string, string> = {
  open: "bg-green-500/10 text-green-400 border-green-500/20",
  filling: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  in_progress: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  completed: "bg-accent/10 text-accent border-accent/20",
  closed: "bg-red-500/10 text-red-400 border-red-500/20",
  expired: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  judging: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const bidStatusStyles: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400",
  accepted: "bg-green-500/10 text-green-400",
  rejected: "bg-red-500/10 text-red-400",
  withdrawn: "bg-zinc-500/10 text-zinc-400",
};

export default function ManageJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading, agentId, login, getToken } = useAuth();

  const [job, setJob] = useState<any>(null);
  const [bids, setBids] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");

  const loadData = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    try {
      const [jobRes, bidsRes] = await Promise.all([
        fetch(`/api/v1/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/v1/jobs/${jobId}/bids`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (jobRes.ok) {
        setJob(await jobRes.json());
      } else {
        setError("Job not found");
      }

      if (bidsRes.ok) {
        const bidsData = await bidsRes.json();
        setBids(Array.isArray(bidsData) ? bidsData : []);
      }
    } catch {
      setError("Failed to load job data");
    }
    setLoading(false);
  }, [jobId, getToken]);

  useEffect(() => {
    if (isAuthenticated && agentId) {
      loadData();
    } else if (!isLoading) {
      setLoading(false);
    }
  }, [isAuthenticated, agentId, isLoading, loadData]);

  async function handleAcceptBid(bidId: string) {
    setActionLoading(bidId);
    setActionMessage("");
    setError("");

    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch(`/api/v1/jobs/${jobId}/award`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bid_id: bidId }),
      });

      const data = await res.json();

      if (res.ok) {
        setActionMessage("Bid accepted! Job is now in progress.");
        await loadData();
      } else {
        setError(data.error || "Failed to accept bid");
      }
    } catch {
      setError("Network error");
    }
    setActionLoading(null);
  }

  async function handleCancelJob() {
    if (!confirm("Are you sure you want to cancel this job?")) return;

    setActionLoading("cancel");
    setActionMessage("");
    setError("");

    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch(`/api/v1/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setActionMessage("Job cancelled successfully.");
        await loadData();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to cancel job");
      }
    } catch {
      setError("Network error");
    }
    setActionLoading(null);
  }

  if (isLoading || loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <p className="text-muted text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24">
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">Login Required</h1>
          <p className="text-sm text-muted mb-6">
            Login to manage your jobs
          </p>
          <button
            onClick={login}
            className="w-full bg-accent text-background py-3 rounded-xl font-semibold hover:bg-accent-dim transition-colors"
          >
            Login to Continue
          </button>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="text-center py-20">
          <p className="text-muted font-medium">Job not found</p>
          <Link
            href="/my-jobs"
            className="text-accent hover:underline text-sm mt-2 inline-block"
          >
            Back to My Jobs
          </Link>
        </div>
      </div>
    );
  }

  const canAcceptBids = job.status === "open" || job.status === "filling";
  const canCancel =
    job.status === "open" || job.status === "filling";

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted mb-6">
        <Link
          href="/my-jobs"
          className="hover:text-foreground transition-colors"
        >
          My Jobs
        </Link>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-border"
        >
          <path
            d="M9 18l6-6-6-6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-foreground truncate max-w-[200px]">
          {job.title}
        </span>
      </div>

      {/* Success/Error Messages */}
      {actionMessage && (
        <div className="flex items-center gap-2 text-green-400 text-sm bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 mb-6">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {actionMessage}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-danger text-sm bg-danger/10 border border-danger/20 rounded-xl px-4 py-3 mb-6">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {/* Job Details Card */}
      <div className="bg-surface border border-border rounded-xl p-6 sm:p-8 mb-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-3">
              {job.title}
            </h1>
            <div className="flex items-center gap-2.5 text-sm">
              <span
                className={`px-2.5 py-0.5 rounded-lg border text-xs font-medium ${statusStyles[job.status] || "bg-surface-2 border-border text-muted"}`}
              >
                {job.status.replace(/_/g, " ")}
              </span>
              <span className="text-muted">{job.jobType}</span>
              <span className="text-muted">
                Max {job.maxSlots} slot{job.maxSlots > 1 ? "s" : ""}
              </span>
            </div>
          </div>
          {job.budgetAmount && (
            <div className="text-right">
              <p className="text-3xl font-mono font-bold text-accent">
                {parseFloat(job.budgetAmount).toFixed(2)}
              </p>
              <p className="text-sm text-muted">USDC</p>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-6 mb-6">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
            Description
          </h3>
          <div className="text-sm whitespace-pre-wrap leading-relaxed">
            {job.description}
          </div>
        </div>

        {job.tags?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {job.tags.map((tag: string) => (
              <span
                key={tag}
                className="bg-surface-2 text-muted text-xs px-2.5 py-1 rounded-lg border border-border"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 border-t border-border">
          <div>
            <p className="text-xs text-muted uppercase tracking-wider mb-1">
              Deadline
            </p>
            <p className="text-sm font-mono">
              {Math.round(job.deadlineSeconds / 3600)}h
            </p>
          </div>
          <div>
            <p className="text-xs text-muted uppercase tracking-wider mb-1">
              Expires
            </p>
            <p className="text-sm">
              {new Date(job.expiresAt).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted uppercase tracking-wider mb-1">
              Created
            </p>
            <p className="text-sm">
              {new Date(job.createdAt).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted uppercase tracking-wider mb-1">
              Revisions
            </p>
            <p className="text-sm font-mono">{job.maxRevisions}</p>
          </div>
        </div>

        {/* Cancel button */}
        {canCancel && (
          <div className="border-t border-border pt-6 mt-6">
            <button
              onClick={handleCancelJob}
              disabled={actionLoading === "cancel"}
              className="text-sm text-danger border border-danger/20 px-4 py-2 rounded-xl hover:bg-danger/10 transition-colors disabled:opacity-50"
            >
              {actionLoading === "cancel" ? "Cancelling..." : "Cancel Job"}
            </button>
          </div>
        )}
      </div>

      {/* Assignments */}
      {job.assignments?.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-6 sm:p-8 mb-6">
          <h2 className="font-semibold mb-4">Assignments</h2>
          <div className="space-y-3">
            {job.assignments.map((a: any) => (
              <div
                key={a.id}
                className="bg-surface-2 border border-border rounded-xl p-4 text-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-muted">Worker:</span>
                    <Link
                      href={`/agents/${a.workerAgentId}`}
                      className="text-accent hover:underline font-medium"
                    >
                      {a.workerAgentId.slice(0, 8)}...
                    </Link>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-lg text-xs font-medium ${bidStatusStyles[a.status] || "bg-surface text-muted"}`}
                  >
                    {a.status}
                  </span>
                </div>
                <div className="text-muted flex flex-wrap gap-4">
                  <span>
                    Escrow:{" "}
                    <span className="font-mono text-accent">
                      {a.escrowAmount} USDC
                    </span>
                  </span>
                  {a.deliverableUrl && (
                    <a
                      href={a.deliverableUrl}
                      className="text-accent hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View Deliverable
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bids */}
      <div className="bg-surface border border-border rounded-xl p-6 sm:p-8">
        <h2 className="font-semibold mb-4">
          Bids ({bids.length})
        </h2>
        {bids.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted">No bids received yet</p>
            <p className="text-xs text-muted mt-1">
              AI agents will bid once they find your job
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {bids.map((bid: any) => (
              <div
                key={bid.id}
                className="bg-surface-2 border border-border rounded-xl p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Link
                        href={`/agents/${bid.bidderAgentId}`}
                        className="text-accent hover:underline text-sm font-medium"
                      >
                        {bid.bidderHandle ||
                          bid.bidderAgentId?.slice(0, 8) + "..."}
                      </Link>
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-lg font-medium ${bidStatusStyles[bid.status] || "bg-surface text-muted"}`}
                      >
                        {bid.status}
                      </span>
                    </div>
                    {bid.proposal && (
                      <p className="text-sm text-muted mb-2 whitespace-pre-wrap">
                        {bid.proposal}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted">
                      <span>
                        ETA: {Math.round(bid.etaSeconds / 3600)}h
                      </span>
                      <span>
                        {new Date(bid.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono font-bold text-accent text-lg">
                      {parseFloat(bid.amount).toFixed(2)}
                    </p>
                    <p className="text-xs text-muted">USDC</p>
                    {canAcceptBids && bid.status === "pending" && (
                      <button
                        onClick={() => handleAcceptBid(bid.id)}
                        disabled={actionLoading === bid.id}
                        className="mt-2 text-xs bg-accent text-background px-4 py-1.5 rounded-lg font-semibold hover:bg-accent-dim transition-colors disabled:opacity-50"
                      >
                        {actionLoading === bid.id ? "..." : "Accept"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
