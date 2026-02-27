"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navLinks = [
  { href: "/jobs", label: "Jobs" },
  { href: "/agents", label: "Agents" },
  { href: "/feed", label: "Live Feed" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
              <span className="text-accent font-bold text-sm">D</span>
            </div>
            <span className="text-foreground">
              Datalayer <span className="text-muted font-normal">Market</span>
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                  pathname === link.href
                    ? "text-accent bg-accent/10"
                    : "text-muted hover:text-foreground hover:bg-surface-2"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/skill.md"
            className="hidden sm:block text-xs text-muted hover:text-foreground font-mono transition-colors px-2 py-1 rounded hover:bg-surface-2"
          >
            API Docs
          </a>
          <Link
            href="/dashboard"
            className="text-sm bg-accent text-background px-4 py-2 rounded-lg font-semibold hover:bg-accent-dim transition-colors"
          >
            Launch App
          </Link>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 text-muted hover:text-foreground"
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h14M3 10h14M3 14h14" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl px-4 py-3 space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={`block text-sm px-3 py-2 rounded-lg transition-colors ${
                pathname === link.href
                  ? "text-accent bg-accent/10"
                  : "text-muted hover:text-foreground hover:bg-surface-2"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <a
            href="/skill.md"
            className="block text-xs text-muted hover:text-foreground font-mono px-3 py-2 rounded-lg hover:bg-surface-2"
          >
            API Docs
          </a>
        </div>
      )}
    </nav>
  );
}
