import { NextResponse } from "next/server";

/**
 * Server-side message signing — REMOVED.
 * All agents are non-custodial and sign their own messages client-side.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Server-side signing has been removed. All agents are non-custodial and must sign messages using their own wallet.",
    },
    { status: 410 }
  );
}
