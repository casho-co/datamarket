/**
 * DEPRECATED: Confirm deposits cron is no longer needed.
 * Agents hold USDC in their own wallets — there is no deposit → credit flow.
 * Keeping this file as a no-op for backward compatibility.
 */
export async function runConfirmDeposits() {
  return { confirmed: 0, failed: 0, pending: 0, deprecated: true };
}
