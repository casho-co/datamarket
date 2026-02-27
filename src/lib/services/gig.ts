import { db, withTransaction, type TX } from "@/lib/db";
import {
  gigs,
  gigOrders,
  escrows,
  agents,
  agentWallets,
  reputation,
  submissionHistory,
  fileUploads,
} from "@/lib/db/schema";
import { eq, and, sql, desc, ilike, or } from "drizzle-orm";
import { validateGigOrderTransition, validateEscrowTransition } from "./state-machine";
import { emitFeedEvent } from "./feed";
import { updateReputation } from "./reputation";
import {
  oracleCreateEscrow,
  oracleRelease as onChainRelease,
  oracleRefund as onChainRefund,
} from "@/lib/bsc/escrow-contract";
import { ESCROW_CONTRACT_ADDRESS, DEFAULT_DEADLINE_HOURS, DEFAULT_DISPUTE_WINDOW_HOURS } from "@/lib/bsc/constants";

const DEFAULT_AUTO_RELEASE_DAYS = 7;

// ── Create Gig ──

export async function createGig(params: {
  sellerAgentId: string;
  title: string;
  description: string;
  price: string;
  deliveryDays: number;
  category?: string;
  tags?: string[];
  maxActiveOrders?: number;
}) {
  const [gig] = await db
    .insert(gigs)
    .values({
      sellerAgentId: params.sellerAgentId,
      title: params.title,
      description: params.description,
      price: params.price,
      deliveryDays: params.deliveryDays,
      category: params.category || null,
      tags: params.tags || [],
      maxActiveOrders: params.maxActiveOrders ?? 5,
    })
    .returning();

  return gig;
}

// ── Update Gig ──

export async function updateGig(
  gigId: string,
  sellerAgentId: string,
  updates: {
    title?: string;
    description?: string;
    price?: string;
    deliveryDays?: number;
    category?: string;
    tags?: string[];
    maxActiveOrders?: number;
    status?: "active" | "paused" | "archived";
  }
) {
  const [gig] = await db.select().from(gigs).where(eq(gigs.id, gigId));
  if (!gig) throw new Error("Gig not found");
  if (gig.sellerAgentId !== sellerAgentId) throw new Error("Not gig owner");

  const [updated] = await db
    .update(gigs)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(gigs.id, gigId))
    .returning();

  return updated;
}

// ── Order Gig (instant escrow) ──

export async function orderGig(params: {
  gigId: string;
  buyerAgentId: string;
  requirements?: string;
}) {
  const result = await withTransaction(async (tx: TX) => {
    const [gig] = await tx.select().from(gigs).where(eq(gigs.id, params.gigId));
    if (!gig) throw new Error("Gig not found");
    if (gig.status !== "active") throw new Error("Gig not active");
    if (gig.sellerAgentId === params.buyerAgentId)
      throw new Error("Cannot order your own gig");

    // Check active order limit
    const activeOrders = await tx
      .select({ id: gigOrders.id })
      .from(gigOrders)
      .where(
        and(
          eq(gigOrders.gigId, params.gigId),
          sql`${gigOrders.status} IN ('pending', 'in_progress', 'delivered')`
        )
      );

    if (activeOrders.length >= gig.maxActiveOrders) {
      throw new Error("Seller has reached max active orders for this gig");
    }

    const amount = parseFloat(gig.price);

    // Debit buyer
    const [debitResult] = await tx
      .update(agentWallets)
      .set({
        balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) - ${amount})::TEXT`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentWallets.agentId, params.buyerAgentId),
          sql`CAST(${agentWallets.balance} AS DECIMAL) >= ${amount}`
        )
      )
      .returning({ agentId: agentWallets.agentId });

    if (!debitResult) throw new Error("Insufficient balance");

    // Create escrow (on-chain)
    const [escrow] = await tx
      .insert(escrows)
      .values({
        gigOrderId: null, // will update below
        funderAgentId: params.buyerAgentId,
        recipientAgentId: gig.sellerAgentId,
        amount: gig.price,
        escrowType: "on_chain",
      })
      .returning();

    // Create order
    const deliverBy = new Date(
      Date.now() + gig.deliveryDays * 24 * 60 * 60 * 1000
    );
    const [order] = await tx
      .insert(gigOrders)
      .values({
        gigId: params.gigId,
        buyerAgentId: params.buyerAgentId,
        sellerAgentId: gig.sellerAgentId,
        escrowId: escrow.id,
        requirements: params.requirements || null,
        deliverBy,
      })
      .returning();

    // Link escrow to order
    await tx
      .update(escrows)
      .set({ gigOrderId: order.id })
      .where(eq(escrows.id, escrow.id));

    // Increment gig total orders
    await tx
      .update(gigs)
      .set({
        totalOrders: sql`${gigs.totalOrders} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(gigs.id, params.gigId));

    return { order, escrow, sellerAgentId: gig.sellerAgentId, price: gig.price };
  });

  // Lock funds on-chain via smart contract
  if (ESCROW_CONTRACT_ADDRESS && result.escrow) {
    const [funder] = await db
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, params.buyerAgentId));
    const [recipient] = await db
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, result.sellerAgentId));

    if (funder?.walletAddress && recipient?.walletAddress) {
      try {
        const txHash = await oracleCreateEscrow({
          escrowId: result.escrow.id,
          buyerAddress: funder.walletAddress,
          sellerAddress: recipient.walletAddress,
          token: "USDC",
          amount: result.price,
          deadlineHours: DEFAULT_DEADLINE_HOURS,
          disputeWindowHours: DEFAULT_DISPUTE_WINDOW_HOURS,
        });
        await db
          .update(escrows)
          .set({ onChainTxHash: txHash })
          .where(eq(escrows.id, result.escrow.id));
      } catch {
        // Rollback: delete escrow and re-credit balance
        await db.delete(escrows).where(eq(escrows.id, result.escrow.id));
        await db
          .update(agentWallets)
          .set({
            balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) + ${parseFloat(result.price)})::TEXT`,
            updatedAt: new Date(),
          })
          .where(eq(agentWallets.agentId, params.buyerAgentId));
        throw new Error("Failed to create on-chain escrow");
      }
    }
  }

  return { order: result.order, escrow: result.escrow };
}

// ── Deliver Gig Order ──

export async function deliverGigOrder(params: {
  orderId: string;
  sellerAgentId: string;
  type: "url" | "file" | "inline" | "hash_only";
  deliverableUrl?: string;
  deliverableHash?: string;
  fileId?: string;
  inlineResponse?: string;
}) {
  const [order] = await db
    .select()
    .from(gigOrders)
    .where(eq(gigOrders.id, params.orderId));

  if (!order) throw new Error("Order not found");
  if (order.sellerAgentId !== params.sellerAgentId)
    throw new Error("Not the seller");

  // If file type, verify the file belongs to this agent
  let resolvedUrl = params.deliverableUrl || null;
  if (params.type === "file" && params.fileId) {
    const [file] = await db
      .select()
      .from(fileUploads)
      .where(eq(fileUploads.id, params.fileId));
    if (!file) throw new Error("File not found");
    if (file.agentId !== params.sellerAgentId)
      throw new Error("File does not belong to this agent");
    resolvedUrl = `r2://${file.fileKey}`;
  }

  const fromStatus = order.status === "pending" ? "in_progress" : order.status;
  if (order.status === "pending") {
    validateGigOrderTransition("pending", "in_progress", order.id);
  }
  validateGigOrderTransition(fromStatus, "delivered", order.id);

  const now = new Date();
  const newRevision = order.revisionCount + 1;
  const autoReleaseAt = new Date(
    now.getTime() + DEFAULT_AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000
  );

  const [updated] = await db
    .update(gigOrders)
    .set({
      status: "delivered",
      deliverableType: params.type,
      deliverableUrl: resolvedUrl,
      deliverableHash: params.deliverableHash || null,
      deliverableFileId: params.fileId || null,
      inlineResponse: params.inlineResponse || null,
      revisionCount: newRevision,
      autoReleaseAt,
    })
    .where(eq(gigOrders.id, params.orderId))
    .returning();

  // Record in submission history
  await db.insert(submissionHistory).values({
    gigOrderId: params.orderId,
    submitterAgentId: params.sellerAgentId,
    revision: newRevision,
    deliverableType: params.type,
    deliverableUrl: resolvedUrl,
    deliverableHash: params.deliverableHash || null,
    deliverableFileId: params.fileId || null,
    inlineResponse: params.inlineResponse || null,
  });

  return updated;
}

// ── Accept Gig Delivery ──

export async function acceptGigDelivery(params: {
  orderId: string;
  buyerAgentId: string;
}) {
  const result = await withTransaction(async (tx: TX) => {
    const [order] = await tx
      .select()
      .from(gigOrders)
      .where(eq(gigOrders.id, params.orderId));

    if (!order) throw new Error("Order not found");
    if (order.buyerAgentId !== params.buyerAgentId)
      throw new Error("Not the buyer");

    validateGigOrderTransition(order.status, "completed", order.id);

    // Release escrow on-chain
    if (order.escrowId) {
      const [escrow] = await tx
        .select()
        .from(escrows)
        .where(eq(escrows.id, order.escrowId));

      if (escrow && escrow.status === "funded") {
        if (!escrow.onChainTxHash) {
          throw new Error("On-chain escrow not yet funded on-chain");
        }
        validateEscrowTransition(escrow.status, "released", escrow.id);
        const releaseTxHash = await onChainRelease(escrow.id);
        await tx
          .update(escrows)
          .set({ status: "released", releasedAt: new Date(), releaseTxHash })
          .where(eq(escrows.id, escrow.id));

        await tx
          .update(reputation)
          .set({
            completedJobs: sql`${reputation.completedJobs} + 1`,
            totalEarned: sql`(CAST(${reputation.totalEarned} AS DECIMAL) + ${parseFloat(escrow.amount)})::TEXT`,
            updatedAt: new Date(),
          })
          .where(eq(reputation.agentId, order.sellerAgentId));
      }
    }

    await tx
      .update(gigOrders)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(gigOrders.id, params.orderId));

    return { order };
  });

  await updateReputation(result.order.sellerAgentId);
  return { success: true };
}

// ── Request Changes on Gig Order ──

export async function requestGigOrderChanges(params: {
  orderId: string;
  buyerAgentId: string;
  feedback: string;
}) {
  const [order] = await db
    .select()
    .from(gigOrders)
    .where(eq(gigOrders.id, params.orderId));

  if (!order) throw new Error("Order not found");
  if (order.buyerAgentId !== params.buyerAgentId)
    throw new Error("Not the buyer");

  validateGigOrderTransition(order.status, "in_progress", order.id);

  // Record feedback on the latest submission history entry
  await db
    .update(submissionHistory)
    .set({ feedback: params.feedback })
    .where(
      and(
        eq(submissionHistory.gigOrderId, params.orderId),
        eq(submissionHistory.revision, order.revisionCount)
      )
    );

  const [updated] = await db
    .update(gigOrders)
    .set({
      status: "in_progress",
      deliverableType: null,
      deliverableUrl: null,
      deliverableHash: null,
      deliverableFileId: null,
      inlineResponse: null,
      autoReleaseAt: null,
    })
    .where(eq(gigOrders.id, params.orderId))
    .returning();

  return updated;
}

// ── Cancel Gig Order ──

export async function cancelGigOrder(params: {
  orderId: string;
  buyerAgentId: string;
}) {
  return withTransaction(async (tx: TX) => {
    const [order] = await tx
      .select()
      .from(gigOrders)
      .where(eq(gigOrders.id, params.orderId));

    if (!order) throw new Error("Order not found");
    if (order.buyerAgentId !== params.buyerAgentId)
      throw new Error("Not the buyer");

    validateGigOrderTransition(order.status, "cancelled", order.id);

    // Refund escrow on-chain
    if (order.escrowId) {
      const [escrow] = await tx
        .select()
        .from(escrows)
        .where(eq(escrows.id, order.escrowId));

      if (escrow && escrow.status === "funded") {
        if (!escrow.onChainTxHash) {
          throw new Error("On-chain escrow not yet funded on-chain");
        }
        validateEscrowTransition(escrow.status, "refunded", escrow.id);
        const refundTxHash = await onChainRefund(escrow.id);
        await tx
          .update(escrows)
          .set({ status: "refunded", refundedAt: new Date(), releaseTxHash: refundTxHash })
          .where(eq(escrows.id, escrow.id));
      }
    }

    const [updated] = await tx
      .update(gigOrders)
      .set({ status: "cancelled" })
      .where(eq(gigOrders.id, params.orderId))
      .returning();

    return updated;
  });
}

// ── List / Get ──

export async function getGigById(gigId: string) {
  const [gig] = await db.select().from(gigs).where(eq(gigs.id, gigId));
  return gig || null;
}

export async function listGigs(params: {
  search?: string;
  category?: string;
  sort?: string;
  limit: number;
  offset: number;
}) {
  let query = db.select().from(gigs).where(eq(gigs.status, "active")).$dynamic();

  if (params.search) {
    query = query.where(
      or(
        ilike(gigs.title, `%${params.search}%`),
        ilike(gigs.description, `%${params.search}%`)
      )
    );
  }

  if (params.category) {
    query = query.where(eq(gigs.category, params.category));
  }

  const orderBy =
    params.sort === "price"
      ? sql`CAST(${gigs.price} AS DECIMAL) ASC`
      : params.sort === "orders"
        ? desc(gigs.totalOrders)
        : params.sort === "rating"
          ? desc(gigs.avgRating)
          : desc(gigs.createdAt);

  return query.orderBy(orderBy).limit(params.limit).offset(params.offset);
}

export async function listGigOrders(
  gigId: string,
  agentId: string,
  limit = 20,
  offset = 0
) {
  return db
    .select()
    .from(gigOrders)
    .where(
      and(
        eq(gigOrders.gigId, gigId),
        or(
          eq(gigOrders.buyerAgentId, agentId),
          eq(gigOrders.sellerAgentId, agentId)
        )
      )
    )
    .orderBy(desc(gigOrders.createdAt))
    .limit(limit)
    .offset(offset);
}
