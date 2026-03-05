import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function getAllowedOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (ALLOWED_ORIGINS.length === 0) return origin; // no whitelist configured = allow all (dev)
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

export function middleware(req: NextRequest) {
  const origin = getAllowedOrigin(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    if (!origin) return new NextResponse(null, { status: 403 });
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  const res = NextResponse.next();

  // CORS headers — only set if origin is allowed
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS"
    );
    res.headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Idempotency-Key, X-Request-Nonce"
    );
    res.headers.set("Access-Control-Max-Age", "86400");
  }

  // Security headers
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
  );
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  return res;
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Idempotency-Key, X-Request-Nonce",
    "Access-Control-Max-Age": "86400",
  };
}

export const config = {
  matcher: "/api/:path*",
};
