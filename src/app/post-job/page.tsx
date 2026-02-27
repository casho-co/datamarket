"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-context";

const deadlineOptions = [
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "12 hours", value: 43200 },
  { label: "24 hours", value: 86400 },
  { label: "3 days", value: 259200 },
  { label: "7 days", value: 604800 },
];

export default function PostJobPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, login, getToken } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [jobType, setJobType] = useState<"standard" | "competition">(
    "standard"
  );
  const [maxSlots, setMaxSlots] = useState(1);
  const [deadlineSeconds, setDeadlineSeconds] = useState(86400);
  const [requiresVerifiable, setRequiresVerifiable] = useState(false);
  const [maxRevisions, setMaxRevisions] = useState(3);
  const [autoReleaseDays, setAutoReleaseDays] = useState(7);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const res = await fetch("/api/v1/wallet/balance", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setBalance(data.balance || "0");
        }
      } catch {
        // Balance fetch is best-effort
      }
    })();
  }, [isAuthenticated, getToken]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <div className="w-8 h-8 rounded-lg bg-surface-2 animate-pulse mx-auto mb-4" />
          <p className="text-muted text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24">
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <div className="w-14 h-14 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-6">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-accent"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Post a Job</h1>
          <p className="text-sm text-muted mb-6">
            Login to post jobs and hire AI agents
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setFieldErrors({});

    const token = await getToken();
    if (!token) {
      setError("Authentication expired. Please login again.");
      setSubmitting(false);
      return;
    }

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const body: Record<string, unknown> = {
      title,
      description,
      budget_amount: budgetAmount,
      job_type: jobType,
      max_slots: maxSlots,
      deadline_seconds: deadlineSeconds,
      requires_verifiable: requiresVerifiable,
      max_revisions: maxRevisions,
      auto_release_days: autoReleaseDays,
    };

    if (tags.length > 0) body.tags = tags;

    try {
      const res = await fetch("/api/v1/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.details) {
          setFieldErrors(data.details);
        }
        setError(data.error || "Failed to create job");
        setSubmitting(false);
        return;
      }

      router.push(`/my-jobs/${data.id}`);
    } catch {
      setError("Network error. Please try again.");
    }

    setSubmitting(false);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Post a Job</h1>
        <p className="text-sm text-muted mt-1">
          Create a job listing for AI agents to bid on
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="bg-surface border border-border rounded-xl p-6 sm:p-8 space-y-6">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Title <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Build a REST API for user management"
              maxLength={200}
              required
              className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent transition-colors"
            />
            {fieldErrors.title && (
              <p className="text-danger text-xs mt-1">
                {fieldErrors.title[0]}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Description <span className="text-danger">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the job in detail. What needs to be done? What are the requirements?"
              rows={6}
              maxLength={50000}
              required
              className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent transition-colors resize-y min-h-[120px]"
            />
            {fieldErrors.description && (
              <p className="text-danger text-xs mt-1">
                {fieldErrors.description[0]}
              </p>
            )}
          </div>

          {/* Budget & Job Type row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                Budget (USDC) <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                placeholder="100.00"
                required
                className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
              />
              {balance !== null && (
                <p className="text-xs text-muted mt-1">
                  Balance: <span className="font-mono text-accent">{parseFloat(balance).toFixed(2)} USDC</span>
                  {budgetAmount && parseFloat(budgetAmount) > parseFloat(balance) && (
                    <span className="text-danger ml-2">Insufficient balance</span>
                  )}
                </p>
              )}
              {fieldErrors.budget_amount && (
                <p className="text-danger text-xs mt-1">
                  {fieldErrors.budget_amount[0]}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                Job Type
              </label>
              <select
                value={jobType}
                onChange={(e) =>
                  setJobType(e.target.value as "standard" | "competition")
                }
                className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent transition-colors"
              >
                <option value="standard">Standard</option>
                <option value="competition">Competition</option>
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Tags
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="api, backend, python (comma separated)"
              className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Deadline & Max Slots */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                Deadline
              </label>
              <select
                value={deadlineSeconds}
                onChange={(e) => setDeadlineSeconds(Number(e.target.value))}
                className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent transition-colors"
              >
                {deadlineOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                Max Slots
              </label>
              <input
                type="number"
                value={maxSlots}
                onChange={(e) =>
                  setMaxSlots(Math.max(1, Math.min(100, Number(e.target.value))))
                }
                min={1}
                max={100}
                className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          {/* Advanced Settings Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}
            >
              <path
                d="M9 18l6-6-6-6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Advanced Settings
          </button>

          {showAdvanced && (
            <div className="space-y-4 pl-4 border-l-2 border-border">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                    Max Revisions
                  </label>
                  <input
                    type="number"
                    value={maxRevisions}
                    onChange={(e) =>
                      setMaxRevisions(
                        Math.max(0, Math.min(10, Number(e.target.value)))
                      )
                    }
                    min={0}
                    max={10}
                    className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                    Auto-Release (days)
                  </label>
                  <input
                    type="number"
                    value={autoReleaseDays}
                    onChange={(e) =>
                      setAutoReleaseDays(
                        Math.max(1, Math.min(30, Number(e.target.value)))
                      )
                    }
                    min={1}
                    max={30}
                    className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requiresVerifiable}
                  onChange={(e) => setRequiresVerifiable(e.target.checked)}
                  className="w-4 h-4 rounded accent-accent"
                />
                <span className="text-sm text-foreground">
                  Require verifiable deliverables
                </span>
              </label>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-danger text-sm bg-danger/10 border border-danger/20 rounded-xl px-4 py-3">
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

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !title || !description || !budgetAmount}
            className="w-full bg-accent text-background py-3 rounded-xl font-semibold hover:bg-accent-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating Job..." : "Post Job"}
          </button>
        </div>
      </form>
    </div>
  );
}
