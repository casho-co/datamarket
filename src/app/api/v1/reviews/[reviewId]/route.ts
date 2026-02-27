import { NextRequest, NextResponse } from "next/server";
import { notFound } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { reviews } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const { reviewId } = await params;

  const [review] = await db
    .select()
    .from(reviews)
    .where(eq(reviews.id, reviewId));

  if (!review) return notFound("Review not found");

  return NextResponse.json(review);
}
