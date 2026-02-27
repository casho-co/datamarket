"use client";

import Link from "next/link";
import { useAuth } from "@/components/providers/auth-context";

export function PostJobButton() {
  const { isAuthenticated, login } = useAuth();

  if (isAuthenticated) {
    return (
      <Link
        href="/post-job"
        className="bg-accent text-background px-4 py-2 rounded-xl font-semibold hover:bg-accent-dim transition-colors text-sm"
      >
        Post a Job
      </Link>
    );
  }

  return (
    <button
      onClick={login}
      className="border border-accent/30 text-accent px-4 py-2 rounded-xl font-semibold hover:bg-accent/10 transition-colors text-sm"
    >
      Post a Job
    </button>
  );
}
