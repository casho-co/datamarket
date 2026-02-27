"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/components/providers/auth-context";

const navLinks = [
  { href: "/jobs", label: "Jobs" },
  { href: "/agents", label: "Agents" },
  { href: "/feed", label: "Live Feed" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { isAuthenticated, isLoading, handle, walletAddress, login, logout } =
    useAuth();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const initial = (handle || walletAddress || "U")[0].toUpperCase();

  return (
    <nav className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
              <span className="text-accent font-bold text-sm">D</span>
            </div>
            <span className="text-foreground">
              Datalayer{" "}
              <span className="text-muted font-normal">Market</span>
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

          {isAuthenticated && (
            <Link
              href="/post-job"
              className={`hidden sm:block text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                pathname === "/post-job"
                  ? "text-accent bg-accent/10"
                  : "text-muted hover:text-foreground hover:bg-surface-2"
              }`}
            >
              Post a Job
            </Link>
          )}

          {isLoading ? (
            <div className="w-20 h-9 bg-surface-2 rounded-lg animate-pulse" />
          ) : isAuthenticated ? (
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border hover:border-accent/30 transition-colors"
              >
                <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <span className="text-accent font-bold text-xs">
                    {initial}
                  </span>
                </div>
                <span className="hidden sm:block text-sm text-foreground truncate max-w-[100px]">
                  {handle || walletAddress?.slice(0, 8) + "..."}
                </span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-muted"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-surface border border-border rounded-xl shadow-lg shadow-black/20 overflow-hidden z-50">
                  <Link
                    href="/my-jobs"
                    onClick={() => setUserMenuOpen(false)}
                    className="block px-4 py-2.5 text-sm text-foreground hover:bg-surface-2 transition-colors"
                  >
                    My Jobs
                  </Link>
                  <Link
                    href="/post-job"
                    onClick={() => setUserMenuOpen(false)}
                    className="block px-4 py-2.5 text-sm text-foreground hover:bg-surface-2 transition-colors"
                  >
                    Post a Job
                  </Link>
                  <Link
                    href="/dashboard"
                    onClick={() => setUserMenuOpen(false)}
                    className="block px-4 py-2.5 text-sm text-muted hover:bg-surface-2 transition-colors"
                  >
                    Agent Dashboard
                  </Link>
                  <div className="border-t border-border">
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        logout();
                      }}
                      className="block w-full text-left px-4 py-2.5 text-sm text-danger hover:bg-surface-2 transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link
                href="/dashboard"
                className="hidden sm:block text-sm text-muted hover:text-foreground px-3 py-1.5 rounded-lg transition-colors hover:bg-surface-2"
              >
                Agent Login
              </Link>
              <button
                onClick={login}
                className="text-sm bg-accent text-background px-4 py-2 rounded-lg font-semibold hover:bg-accent-dim transition-colors"
              >
                Login
              </button>
            </>
          )}

          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 text-muted hover:text-foreground"
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
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
          {isAuthenticated && (
            <>
              <Link
                href="/post-job"
                onClick={() => setMobileOpen(false)}
                className="block text-sm px-3 py-2 rounded-lg text-accent hover:bg-surface-2 transition-colors"
              >
                Post a Job
              </Link>
              <Link
                href="/my-jobs"
                onClick={() => setMobileOpen(false)}
                className="block text-sm px-3 py-2 rounded-lg text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
              >
                My Jobs
              </Link>
            </>
          )}
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
