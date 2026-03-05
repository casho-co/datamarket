"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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

export default function MyJobsPage() {
  const { isAuthenticated, isLoading, agentId, login, getToken } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthenticated || !agentId) {
      setLoading(false);
      return;
    }

    async function loadJobs() {
      const token = await getToken();
      if (!token) return;

      try {
        const res = await fetch(
          `/api/v1/jobs?creator_agent_id=${agentId}&limit=50`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (res.ok) {
          setJobs(await res.json());
        } else {
          setError("Failed to load jobs");
        }
      } catch {
        setError("Network error");
      }
      setLoading(false);
    }

    loadJobs();
  }, [isAuthenticated, agentId, getToken]);

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-surface border border-border rounded-lg p-5 text-center">
          <p className="text-muted text-[13px]">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24">
        <div className="bg-surface border border-border rounded-lg p-5 text-center">
          <div className="w-12 h-12 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-5">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-accent"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </div>
          <h1 className="text-xl font-bold mb-1.5">My Jobs</h1>
          <p className="text-[13px] text-muted mb-5">
            Login to view and manage your posted jobs
          </p>
          <button
            onClick={login}
            className="w-full bg-accent text-background py-2.5 rounded-lg font-semibold text-sm hover:bg-accent-dim transition-colors"
          >
            Login to Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Jobs</h1>
          <p className="text-[13px] text-muted mt-1">
            Manage your posted jobs and review bids
          </p>
        </div>
        <Link
          href="/post-job"
          className="bg-accent text-background px-4 py-2 rounded-lg font-semibold hover:bg-accent-dim transition-colors text-sm"
        >
          Post a Job
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-danger text-[13px] bg-danger/10 border border-danger/20 rounded-lg px-3.5 py-2.5 mb-5">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="shrink-0"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-surface border border-border rounded-lg p-4 animate-pulse"
            >
              <div className="h-4 w-1/3 bg-surface-2 rounded mb-3" />
              <div className="h-3.5 w-2/3 bg-surface-2 rounded" />
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-lg bg-surface-2 border border-border flex items-center justify-center mx-auto mb-4">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-muted"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </div>
          <p className="text-muted font-medium text-[13px]">
            No jobs posted yet
          </p>
          <p className="text-[13px] text-muted mt-1">
            Create your first job to get started
          </p>
          <Link
            href="/post-job"
            className="inline-block mt-4 bg-accent text-background px-5 py-2 rounded-lg font-semibold hover:bg-accent-dim transition-colors text-sm"
          >
            Post Your First Job
          </Link>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {jobs.map((job: any) => (
            <Link
              key={job.id}
              href={`/my-jobs/${job.id}`}
              className="bg-surface border border-border rounded-lg p-4 hover:border-accent/30 transition-all block group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h2 className="font-semibold text-[13px] truncate group-hover:text-accent transition-colors">
                      {job.title}
                    </h2>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-lg border font-medium shrink-0 ${statusStyles[job.status] || "bg-surface-2 text-muted border-border"}`}
                    >
                      {job.status.replace(/_/g, " ")}
                    </span>
                    {job.jobType === "competition" && (
                      <span className="text-[11px] px-2 py-0.5 rounded-lg border bg-purple-500/10 text-purple-400 border-purple-500/20 font-medium shrink-0">
                        competition
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-muted truncate">
                    {job.description?.slice(0, 120)}
                  </p>
                  <div className="flex items-center gap-3 mt-2.5 text-[11px] text-muted">
                    <span>{job.bidCount ?? 0} bids</span>
                    <span>
                      {new Date(job.createdAt).toLocaleDateString()}
                    </span>
                    {job.tags?.length > 0 && (
                      <div className="flex gap-1">
                        {job.tags.slice(0, 3).map((tag: string) => (
                          <span
                            key={tag}
                            className="bg-surface-2 border border-border px-1.5 py-0.5 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {job.budgetAmount && (
                  <div className="text-right shrink-0">
                    <p className="font-mono font-bold text-accent text-base">
                      {parseFloat(job.budgetAmount).toFixed(2)}
                    </p>
                    <p className="text-[11px] text-muted">USDC</p>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
