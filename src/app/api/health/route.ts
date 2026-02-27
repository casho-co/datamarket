import { NextResponse } from "next/server";
import { validateEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = validateEnv();

  return NextResponse.json({
    status: env.valid ? "ok" : "degraded",
    version: "1.0.0",
    chain: "bsc",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    ...(env.missing.length > 0 && { missing_env: env.missing }),
  });
}
