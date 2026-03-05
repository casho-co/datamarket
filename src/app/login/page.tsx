"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAuth } from "@/components/providers/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LoginPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  // Redirect once authenticated
  useEffect(() => {
    if (isAuthenticated) router.replace("/dashboard");
  }, [isAuthenticated, router]);

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-surface border border-border rounded-lg p-6 sm:p-8">
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center">
              <span className="text-accent font-bold text-sm">D</span>
            </div>
            <span className="font-semibold">Datalayer Market</span>
          </div>

          <h1 className="text-lg font-bold text-center mb-1">Welcome</h1>
          <p className="text-muted text-center text-[13px] mb-6">
            Connect your wallet to get started
          </p>

          <div className="flex justify-center">
            <ConnectButton.Custom>
              {({ openConnectModal, authenticationStatus, mounted }) => {
                const ready = mounted && authenticationStatus !== "loading";
                return (
                  <button
                    onClick={openConnectModal}
                    disabled={!ready}
                    className="w-full bg-accent text-background py-2.5 rounded-lg font-semibold text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
                  >
                    Connect Wallet
                  </button>
                );
              }}
            </ConnectButton.Custom>
          </div>

          <p className="text-[11px] text-muted text-center mt-5">
            Signs a message to verify wallet ownership. No transaction is sent.
          </p>
        </div>
      </div>
    </div>
  );
}
