import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getPublicClient } from "@/lib/bsc/client";
import { ERC8004_IDENTITY_REGISTRY } from "@/lib/bsc/constants";
import {
  parseTokenIdFromReceipt,
  getIdentityOwnerOf,
} from "@/lib/bsc/erc8004";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { Hex } from "viem";

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { blocked: rl } = await checkRateLimit(ip, "sensitive");
  if (rl) return rl;

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (auth.erc8004AgentId) {
    return NextResponse.json(
      { error: "On-chain identity already linked" },
      { status: 409 }
    );
  }

  const body = await req.json();
  const txHash = body?.tx_hash;
  if (!txHash || !TX_HASH_RE.test(txHash)) {
    return NextResponse.json(
      { error: "Invalid or missing tx_hash" },
      { status: 400 }
    );
  }

  const client = getPublicClient();

  // Fetch transaction receipt
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    return NextResponse.json(
      {
        error: "Transaction not yet confirmed. Please wait and retry.",
      },
      { status: 202 }
    );
  }

  // Verify transaction succeeded
  if (receipt.status !== "success") {
    return NextResponse.json(
      { error: "Transaction reverted on-chain" },
      { status: 400 }
    );
  }

  // Verify target contract
  if (
    receipt.to?.toLowerCase() !== ERC8004_IDENTITY_REGISTRY.toLowerCase()
  ) {
    return NextResponse.json(
      { error: "Transaction was not sent to the ERC-8004 Identity Registry" },
      { status: 400 }
    );
  }

  // Verify sender is the authenticated agent
  if (receipt.from.toLowerCase() !== auth.walletAddress?.toLowerCase()) {
    return NextResponse.json(
      { error: "Transaction was not sent from your wallet" },
      { status: 403 }
    );
  }

  // Extract tokenId from Transfer event
  const tokenId = parseTokenIdFromReceipt(receipt);
  if (tokenId === null) {
    return NextResponse.json(
      { error: "Could not find minted tokenId in transaction logs" },
      { status: 400 }
    );
  }

  // Belt-and-suspenders: verify current ownership
  const currentOwner = await getIdentityOwnerOf(tokenId);
  if (currentOwner !== auth.walletAddress?.toLowerCase()) {
    return NextResponse.json(
      { error: "You do not currently own this identity NFT" },
      { status: 403 }
    );
  }

  // Check no other agent has claimed this tokenId
  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.erc8004AgentId, tokenId));
  if (existing) {
    return NextResponse.json(
      { error: "This identity NFT is already linked to another agent" },
      { status: 409 }
    );
  }

  // Link the identity
  await db
    .update(agents)
    .set({ erc8004AgentId: tokenId, updatedAt: new Date() })
    .where(eq(agents.id, auth.agentId));

  await logAudit({
    agentId: auth.agentId,
    action: "confirm_mint",
    resourceType: "agent",
    resourceId: auth.agentId,
    metadata: { erc8004AgentId: tokenId.toString(), txHash },
    ipAddress: ip,
  });

  return NextResponse.json({
    ok: true,
    erc8004_agent_id: tokenId.toString(),
  });
}
