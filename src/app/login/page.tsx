"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/components/providers/auth-context";
import { useRouter } from "next/navigation";
import { createSiweMessage } from "viem/siwe";

// ── helpers ──────────────────────────────────────────────────────────────────

async function getNonce(): Promise<string> {
  const res = await fetch("/api/siwe/nonce");
  if (!res.ok) throw new Error(`Nonce fetch failed: ${res.status}`);
  return res.text();
}

async function verifySignature(message: string, signature: string) {
  const res = await fetch("/api/siwe/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "Verification failed");
  return data as {
    ok: true;
    access_token: string;
    agent_id: string;
    handle: string | null;
    wallet_address: string;
    erc8004_agent_id?: string | null;
  };
}

type Step = "idle" | "connecting" | "signing" | "verifying" | "done" | "error";

// ── component ─────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { isAuthenticated, setSession } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const inProgressRef = useRef(false);

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) router.replace("/dashboard");
  }, [isAuthenticated, router]);

  const handleConnect = useCallback(async () => {
    if (inProgressRef.current) return;
    inProgressRef.current = true;
    setError(null);

    try {
      // ── Step 1: detect wallet ─────────────────────────────────────────────
      const eth = (window as unknown as Record<string, unknown>).ethereum as
        | {
            request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
          }
        | undefined;

      if (!eth) {
        setError(
          "No wallet detected. Install MetaMask or Rabby then refresh and try again."
        );
        setStep("error");
        return;
      }

      // ── Step 2: request accounts ──────────────────────────────────────────
      setStep("connecting");
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];

      if (!accounts.length) {
        setError("No account selected. Please connect your wallet and try again.");
        setStep("error");
        return;
      }

      const address = accounts[0];

      // ── Step 3: fetch nonce ───────────────────────────────────────────────
      const nonce = await getNonce();

      // ── Step 4: build SIWE message ────────────────────────────────────────
      const chainId = 56; // BSC mainnet
      const expirationTime = new Date(Date.now() + 5 * 60 * 1000); // 5 min, matches nonce TTL
      const message = createSiweMessage({
        scheme: window.location.protocol.replace(":", "") as "https" | "http",
        domain: window.location.host,
        address: address as `0x${string}`,
        statement: "Sign in to Datalayer Market to verify wallet ownership.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce,
        expirationTime,
      });

      // ── Step 5: sign ──────────────────────────────────────────────────────
      setStep("signing");
      const signature = (await eth.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;

      // ── Step 6: verify on backend ─────────────────────────────────────────
      setStep("verifying");
      const data = await verifySignature(message, signature);

      // ── Step 7: store session + redirect ──────────────────────────────────
      setSession(data.access_token, {
        agentId: data.agent_id,
        handle: data.handle,
        walletAddress: data.wallet_address,
        erc8004AgentId: data.erc8004_agent_id ?? null,
      });

      setStep("done");
      router.replace("/dashboard");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      if (
        msg.toLowerCase().includes("user rejected") ||
        msg.includes("4001") ||
        msg.toLowerCase().includes("user denied")
      ) {
        setError("You rejected the sign-in request. Click Try Again when ready.");
      } else {
        setError(msg);
      }
      setStep("error");
    } finally {
      inProgressRef.current = false;
    }
  }, [router, setSession]);

  const buttonLabel: Record<Step, string> = {
    idle: "Connect Wallet",
    connecting: "Connecting…",
    signing: "Check your wallet…",
    verifying: "Verifying…",
    done: "Redirecting…",
    error: "Try Again",
  };

  const busy =
    step === "connecting" ||
    step === "signing" ||
    step === "verifying" ||
    step === "done";

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-surface border border-border rounded-lg p-6 sm:p-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center">
              <span className="text-accent font-bold text-sm">D</span>
            </div>
            <span className="font-semibold">Datalayer Market</span>
          </div>

          <h1 className="text-lg font-bold text-center mb-1">Welcome</h1>
          <p className="text-muted text-center text-[13px] mb-6">
            Connect your wallet to sign in
          </p>

          {/* Error */}
          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] leading-relaxed">
              {error}
            </div>
          )}

          {/* Progress hint */}
          {busy && step !== "done" && (
            <div className="mb-4 px-3 py-2 rounded-md bg-accent/5 border border-accent/10 text-accent text-[12px] text-center">
              {step === "connecting" && "Opening wallet…"}
              {step === "signing" && "Please sign the message in your wallet."}
              {step === "verifying" && "Verifying your identity…"}
            </div>
          )}

          {/* Connect button */}
          <button
            onClick={handleConnect}
            disabled={busy}
            className="w-full bg-accent text-background py-2.5 rounded-lg font-semibold text-sm hover:bg-accent-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {buttonLabel[step]}
          </button>

          <p className="text-[11px] text-muted text-center mt-4">
            Works with MetaMask, Rabby, Coinbase Wallet, and any browser wallet
          </p>
          <p className="text-[11px] text-muted text-center mt-1">
            Signs a message to verify ownership. No transaction is sent.
          </p>
        </div>
      </div>
    </div>
  );
}
