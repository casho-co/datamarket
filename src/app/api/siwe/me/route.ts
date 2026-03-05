import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/jwt";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ address: null });
  }

  const payload = await verifySessionToken(token);
  if (!payload) {
    return NextResponse.json({ address: null });
  }

  return NextResponse.json({ address: payload.walletAddress });
}
