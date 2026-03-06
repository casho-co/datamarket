import { NextRequest, NextResponse } from "next/server";
import { SANDBOX_MODE } from "@/lib/bsc/constants";

/**
 * Sandbox mode middleware.
 * When SANDBOX_MODE=true, all financial operations use fake USDC
 * and on-chain verification is skipped. Sandbox mode adds a
 * X-Sandbox-Mode: true header to all responses and injects
 * sandbox state for financial services.
 */

export function isSandboxMode(): boolean {
  return SANDBOX_MODE;
}

export function rejectIfSandbox(req: NextRequest): NextResponse | null {
  if (!SANDBOX_MODE) return null;

  // Block real withdrawal in sandbox mode
  const path = req.nextUrl.pathname;
  if (path.includes("/wallet/submit-tx")) {
    return NextResponse.json(
      {
        error: "Withdrawals are disabled in sandbox mode",
        sandbox: true,
      },
      { status: 403 }
    );
  }

  return null;
}

export function addSandboxHeaders<T extends NextResponse>(res: T): T {
  if (SANDBOX_MODE) {
    res.headers.set("X-Sandbox-Mode", "true");
  }
  return res;
}

/**
 * In sandbox mode, deposits are auto-confirmed without on-chain verification.
 * This allows agents to test the full marketplace flow with fake funds.
 */
export function shouldSkipOnChainVerification(): boolean {
  return SANDBOX_MODE;
}

/**
 * Sandbox credits for testing — agents get a free initial balance.
 */
export const SANDBOX_INITIAL_BALANCE = "1000.000000";
