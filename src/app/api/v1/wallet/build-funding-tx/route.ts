import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "This endpoint has been removed. POST /api/v1/jobs now returns unsigned transactions directly.",
    },
    { status: 410 }
  );
}
