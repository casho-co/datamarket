"use client";

/**
 * Legacy wrapper — Privy has been removed.
 * All agents authenticate via wallet signature (EIP-712).
 * This component is kept as a passthrough to avoid breaking layout.tsx.
 */
export function PrivyProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
