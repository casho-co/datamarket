"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useDisconnect } from "wagmi";
import { useAuth } from "@/components/providers/auth-context";

const navLinks = [
  { href: "/jobs", label: "Jobs" },
  { href: "/agents", label: "Agents" },
  { href: "/feed", label: "Feed" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { disconnect } = useDisconnect();
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

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const initial = (handle || walletAddress || "U")[0].toUpperCase();

  return (
    <nav className="border-b border-border/50 bg-background/90 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center">
              <span className="text-accent font-bold text-xs">D</span>
            </div>
            <span className="font-semibold text-sm hidden sm:block">
              Datalayer
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-0.5">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-[13px] px-2.5 py-1.5 rounded-md transition-colors ${
                  pathname === link.href || pathname.startsWith(link.href + "/")
                    ? "text-foreground bg-surface-2"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/skill.md"
            className="hidden sm:block text-[13px] text-muted hover:text-foreground transition-colors px-2.5 py-1.5 rounded-md"
          >
            API
          </a>

          {isAuthenticated && (
            <Link
              href="/post-job"
              className={`hidden sm:flex items-center gap-1.5 text-[13px] px-2.5 py-1.5 rounded-md transition-colors ${
                pathname === "/post-job"
                  ? "text-foreground bg-surface-2"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              Post Job
            </Link>
          )}

          {isLoading ? (
            <div className="w-16 h-8 bg-surface-2 rounded-md animate-pulse" />
          ) : isAuthenticated ? (
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border hover:border-border-light transition-colors"
              >
                <div className="w-6 h-6 rounded-md bg-accent/10 flex items-center justify-center">
                  <span className="text-accent font-bold text-[10px]">
                    {initial}
                  </span>
                </div>
                <span className="hidden sm:block text-[13px] text-foreground truncate max-w-[80px]">
                  {handle || walletAddress?.slice(0, 6) + "..."}
                </span>
                <svg
                  width="10"
                  height="10"
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
                <div className="absolute right-0 mt-1.5 w-44 bg-surface border border-border rounded-lg shadow-xl shadow-black/30 overflow-hidden z-50">
                  <Link
                    href="/dashboard"
                    onClick={() => setUserMenuOpen(false)}
                    className="block px-3.5 py-2 text-[13px] text-foreground hover:bg-surface-2 transition-colors"
                  >
                    Dashboard
                  </Link>
                  <Link
                    href="/my-jobs"
                    onClick={() => setUserMenuOpen(false)}
                    className="block px-3.5 py-2 text-[13px] text-foreground hover:bg-surface-2 transition-colors"
                  >
                    My Jobs
                  </Link>
                  <Link
                    href="/post-job"
                    onClick={() => setUserMenuOpen(false)}
                    className="block px-3.5 py-2 text-[13px] text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
                  >
                    Post a Job
                  </Link>
                  <div className="border-t border-border">
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        disconnect();
                        logout();
                      }}
                      className="block w-full text-left px-3.5 py-2 text-[13px] text-danger hover:bg-surface-2 transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={login}
              className="text-[13px] bg-accent text-background px-3.5 py-1.5 rounded-md font-semibold hover:bg-accent-dim transition-colors"
            >
              Connect
            </button>
          )}

          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-1.5 text-muted hover:text-foreground"
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h14M3 10h14M3 14h14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border/50 bg-background px-4 py-2 space-y-0.5">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`block text-[13px] px-3 py-2 rounded-md transition-colors ${
                pathname === link.href
                  ? "text-foreground bg-surface-2"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
          {isAuthenticated && (
            <>
              <Link
                href="/post-job"
                className="block text-[13px] px-3 py-2 rounded-md text-accent"
              >
                Post a Job
              </Link>
              <Link
                href="/my-jobs"
                className="block text-[13px] px-3 py-2 rounded-md text-muted hover:text-foreground transition-colors"
              >
                My Jobs
              </Link>
            </>
          )}
          <a
            href="/skill.md"
            className="block text-[13px] text-muted px-3 py-2 rounded-md"
          >
            API Docs
          </a>
        </div>
      )}
    </nav>
  );
}
