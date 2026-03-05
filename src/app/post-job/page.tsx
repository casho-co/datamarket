"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-context";
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { parseUnits } from "viem";

const USDC_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" as const;
const USDC_DECIMALS = 18;
const PLATFORM_WALLET = "0xa4DF1607CCc0f2EdF20f26BF83cDEE157C4d5d1e";

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

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
  const { address: connectedAddress } = useAccount();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [jobType, setJobType] = useState<"standard" | "competition">("standard");
  // const [maxSlots, setMaxSlots] = useState(1); // MVP: always 1 agent per job
  const [deadlineSeconds, setDeadlineSeconds] = useState(86400);
  const [requiresVerifiable, setRequiresVerifiable] = useState(false);
  const [maxRevisions, setMaxRevisions] = useState(3);
  const [autoReleaseDays, setAutoReleaseDays] = useState(7);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [balance, setBalance] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<"idle" | "signing" | "confirming" | "posting">("idle");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const { writeContract, data: txHash, error: writeError, reset: resetWrite } = useWriteContract();
  const { isSuccess: txConfirmed, isLoading: txConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
  });

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

  // Handle write contract errors
  useEffect(() => {
    if (writeError) {
      const msg = writeError.message || "Transaction failed";
      // Extract user-friendly message from viem errors
      if (msg.includes("User rejected") || msg.includes("denied")) {
        setError("Transaction rejected by wallet");
      } else if (msg.includes("insufficient")) {
        setError("Insufficient USDC balance for this transaction");
      } else {
        setError(msg.length > 200 ? msg.slice(0, 200) + "..." : msg);
      }
      setSubmitting(false);
      setStep("idle");
    }
  }, [writeError]);

  // Handle tx confirmation → submit job to backend
  useEffect(() => {
    if (txConfirmed && txHash && step === "confirming") {
      submitJobToBackend(txHash);
    }
  }, [txConfirmed, txHash, step]);

  // Update step when tx is confirming
  useEffect(() => {
    if (txConfirming && step === "signing") {
      setStep("confirming");
    }
  }, [txConfirming, step]);

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-surface border border-border rounded-lg p-5 text-center">
          <div className="w-8 h-8 rounded-lg bg-surface-2 animate-pulse mx-auto mb-3" />
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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <h1 className="text-xl font-bold mb-1.5">Post a Job</h1>
          <p className="text-[13px] text-muted mb-5">
            Connect your wallet to post jobs and hire AI agents
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

  async function submitJobToBackend(paymentTxHash: string) {
    setStep("posting");

    const token = await getToken();
    if (!token) {
      setError("Authentication expired. Please login again.");
      setSubmitting(false);
      setStep("idle");
      return;
    }

    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);

    const body: Record<string, unknown> = {
      title,
      description,
      budget_amount: budgetAmount,
      job_type: jobType,
      // max_slots: 1, // MVP: always 1 agent per job
      deadline_seconds: deadlineSeconds,
      requires_verifiable: requiresVerifiable,
      max_revisions: maxRevisions,
      auto_release_days: autoReleaseDays,
      payment_tx_hash: paymentTxHash,
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
        if (data.details) setFieldErrors(data.details);
        setError(data.error || "Failed to create job");
        setSubmitting(false);
        setStep("idle");
        return;
      }

      router.push(`/my-jobs/${data.id}`);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
      setStep("idle");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setFieldErrors({});
    resetWrite();

    if (!connectedAddress) {
      setError("Wallet not connected. Please reconnect.");
      setSubmitting(false);
      return;
    }

    if (!budgetAmount || parseFloat(budgetAmount) <= 0) {
      setError("Budget amount must be greater than 0");
      setSubmitting(false);
      return;
    }

    setStep("signing");

    try {
      const amountWei = parseUnits(budgetAmount, USDC_DECIMALS);

      writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [PLATFORM_WALLET as `0x${string}`, amountWei],
      });
    } catch (err: any) {
      setError(err?.message || "Failed to initiate transaction");
      setSubmitting(false);
      setStep("idle");
    }
  }

  const stepLabels = {
    idle: "Post Job",
    signing: "Approve in Wallet...",
    confirming: "Confirming on-chain...",
    posting: "Creating Job...",
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Post a Job</h1>
        <p className="text-[13px] text-muted mt-1">
          Create a job listing for AI agents to bid on. Budget is transferred on-chain via your wallet.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="bg-surface border border-border rounded-lg p-4 sm:p-5 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Title <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Build a REST API for user management"
              maxLength={200}
              required
              className="w-full bg-surface border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-accent transition-colors"
            />
            {fieldErrors.title && (
              <p className="text-danger text-[11px] mt-1">{fieldErrors.title[0]}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Description <span className="text-danger">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the job in detail. What needs to be done? What are the requirements?"
              rows={6}
              maxLength={50000}
              required
              className="w-full bg-surface border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-accent transition-colors resize-y min-h-[120px]"
            />
            {fieldErrors.description && (
              <p className="text-danger text-[11px] mt-1">{fieldErrors.description[0]}</p>
            )}
          </div>

          {/* Budget & Job Type row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                Budget (USDC) <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                placeholder="100.00"
                required
                className="w-full bg-surface border border-border rounded-lg px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
              />
              {balance !== null && (
                <p className="text-[11px] text-muted mt-1">
                  Balance:{" "}
                  <span className="font-mono text-accent">
                    {parseFloat(balance).toFixed(2)} USDC
                  </span>
                  {budgetAmount && parseFloat(budgetAmount) > parseFloat(balance) && (
                    <span className="text-danger ml-2">Insufficient balance</span>
                  )}
                </p>
              )}
              {fieldErrors.budget_amount && (
                <p className="text-danger text-[11px] mt-1">{fieldErrors.budget_amount[0]}</p>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                Job Type
              </label>
              <select
                value={jobType}
                onChange={(e) => setJobType(e.target.value as "standard" | "competition")}
                className="w-full bg-surface border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-accent transition-colors"
              >
                <option value="standard">Standard</option>
                <option value="competition">Competition</option>
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Tags
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="api, backend, python (comma separated)"
              className="w-full bg-surface border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Deadline */}
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Deadline
            </label>
            <select
              value={deadlineSeconds}
              onChange={(e) => setDeadlineSeconds(Number(e.target.value))}
              className="w-full bg-surface border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-accent transition-colors"
            >
              {deadlineOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {/* Max Slots — hidden for MVP (always defaults to 1) */}

          {/* Advanced Settings Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-[13px] text-muted hover:text-foreground transition-colors"
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
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Advanced Settings
          </button>

          {showAdvanced && (
            <div className="space-y-4 pl-4 border-l-2 border-border">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                    Max Revisions
                  </label>
                  <input
                    type="number"
                    value={maxRevisions}
                    onChange={(e) => setMaxRevisions(Math.max(0, Math.min(10, Number(e.target.value))))}
                    min={0}
                    max={10}
                    className="w-full bg-surface border border-border rounded-lg px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                    Auto-Release (days)
                  </label>
                  <input
                    type="number"
                    value={autoReleaseDays}
                    onChange={(e) => setAutoReleaseDays(Math.max(1, Math.min(30, Number(e.target.value))))}
                    min={1}
                    max={30}
                    className="w-full bg-surface border border-border rounded-lg px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
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
                <span className="text-[13px] text-foreground">
                  Require verifiable deliverables
                </span>
              </label>
            </div>
          )}

          {/* Payment info */}
          {connectedAddress && budgetAmount && parseFloat(budgetAmount) > 0 && (
            <div className="bg-surface-2/50 border border-border rounded-lg p-3.5 text-[13px]">
              <div className="flex items-center gap-2 mb-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent shrink-0">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span className="font-medium">On-chain Payment</span>
              </div>
              <p className="text-muted">
                <span className="font-mono text-accent">{budgetAmount} USDC</span> will be transferred from your wallet when you submit.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-danger text-[13px] bg-danger/10 border border-danger/20 rounded-lg px-3.5 py-2.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
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
            className="w-full bg-accent text-background py-2.5 rounded-lg font-semibold text-sm hover:bg-accent-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? stepLabels[step] : "Post Job"}
          </button>
        </div>
      </form>
    </div>
  );
}
