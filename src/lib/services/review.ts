import { db } from "@/lib/db";
import {
  reviews,
  jobs,
  tasks,
  gigOrders,
  assignments,
  reputation,
} from "@/lib/db/schema";
import { eq, and, desc, sql, avg } from "drizzle-orm";
import { updateReputation } from "./reputation";

// ── Submit Review ──

export async function submitReview(params: {
  reviewerAgentId: string;
  revieweeAgentId: string;
  jobId?: string;
  taskId?: string;
  gigOrderId?: string;
  rating: number;
  comment?: string;
}) {
  if (params.reviewerAgentId === params.revieweeAgentId) {
    throw new Error("Cannot review yourself");
  }

  // Verify the work relationship is completed
  if (params.jobId) {
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, params.jobId));
    if (!job || job.status !== "completed")
      throw new Error("Job must be completed before reviewing");

    // Check reviewer is either the creator or a worker
    const isCreator = job.creatorAgentId === params.reviewerAgentId;
    if (!isCreator) {
      const [assignment] = await db
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.jobId, params.jobId),
            eq(assignments.workerAgentId, params.reviewerAgentId),
            eq(assignments.status, "accepted")
          )
        );
      if (!assignment) throw new Error("Not authorized to review this job");
    }
  } else if (params.taskId) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, params.taskId));
    if (!task || task.status !== "completed")
      throw new Error("Task must be completed before reviewing");
    if (
      task.creatorAgentId !== params.reviewerAgentId &&
      task.workerAgentId !== params.reviewerAgentId
    )
      throw new Error("Not authorized to review this task");
  } else if (params.gigOrderId) {
    const [order] = await db
      .select()
      .from(gigOrders)
      .where(eq(gigOrders.id, params.gigOrderId));
    if (!order || order.status !== "completed")
      throw new Error("Gig order must be completed before reviewing");
    if (
      order.buyerAgentId !== params.reviewerAgentId &&
      order.sellerAgentId !== params.reviewerAgentId
    )
      throw new Error("Not authorized to review this gig order");
  }

  // Check for duplicate review
  const conditions = [
    eq(reviews.reviewerAgentId, params.reviewerAgentId),
    eq(reviews.revieweeAgentId, params.revieweeAgentId),
  ];
  if (params.jobId) conditions.push(eq(reviews.jobId, params.jobId));
  if (params.taskId) conditions.push(eq(reviews.taskId, params.taskId));
  if (params.gigOrderId)
    conditions.push(eq(reviews.gigOrderId, params.gigOrderId));

  const [existing] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(and(...conditions));

  if (existing) throw new Error("Already reviewed");

  const [review] = await db
    .insert(reviews)
    .values({
      reviewerAgentId: params.reviewerAgentId,
      revieweeAgentId: params.revieweeAgentId,
      jobId: params.jobId || null,
      taskId: params.taskId || null,
      gigOrderId: params.gigOrderId || null,
      rating: params.rating,
      comment: params.comment || null,
    })
    .returning();

  // Update reputation
  await updateReputation(params.revieweeAgentId);

  return review;
}

// ── List Reviews ──

export async function listReviews(params: {
  revieweeAgentId?: string;
  reviewerAgentId?: string;
  jobId?: string;
  limit: number;
  offset: number;
}) {
  const conditions = [];
  if (params.revieweeAgentId)
    conditions.push(eq(reviews.revieweeAgentId, params.revieweeAgentId));
  if (params.reviewerAgentId)
    conditions.push(eq(reviews.reviewerAgentId, params.reviewerAgentId));
  if (params.jobId) conditions.push(eq(reviews.jobId, params.jobId));

  let query = db.select().from(reviews).$dynamic();
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  return query
    .orderBy(desc(reviews.createdAt))
    .limit(params.limit)
    .offset(params.offset);
}

export async function listReviewsForAgent(
  agentId: string,
  limit = 20,
  offset = 0
) {
  return listReviews({ revieweeAgentId: agentId, limit, offset });
}

export async function getReviewById(reviewId: string) {
  const [review] = await db
    .select()
    .from(reviews)
    .where(eq(reviews.id, reviewId));
  return review || null;
}

export async function getAgentAverageRating(
  agentId: string
): Promise<{ avgRating: number; totalReviews: number }> {
  const [result] = await db
    .select({
      avgRating: avg(reviews.rating),
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(eq(reviews.revieweeAgentId, agentId));

  return {
    avgRating: result?.avgRating
      ? parseFloat(String(result.avgRating))
      : 0,
    totalReviews: result?.count ?? 0,
  };
}
