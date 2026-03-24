import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { getClientIp } from "@/lib/services/audit";
import {
  getIdentityBalanceOf,
  buildMintIdentityData,
} from "@/lib/bsc/erc8004";
import { BSC_CHAIN_ID } from "@/lib/bsc/constants";

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

  if (!auth.walletAddress) {
    return NextResponse.json(
      { error: "No wallet address associated with this agent" },
      { status: 400 }
    );
  }

  // Check if wallet already owns ERC-8004 NFTs — prevent duplicate minting
  const balance = await getIdentityBalanceOf(auth.walletAddress);
  if (balance > BigInt(0)) {
    return NextResponse.json(
      {
        error:
          "Your wallet already owns ERC-8004 identity NFTs. Use GET /api/v1/agents/identities to list them, then POST /api/v1/agents/link-identity to link one.",
        existing_count: balance.toString(),
        next_actions: [
          {
            action: "list_identities",
            method: "GET",
            path: "/api/v1/agents/identities",
          },
          {
            action: "link_identity",
            method: "POST",
            path: "/api/v1/agents/link-identity",
          },
        ],
      },
      { status: 409 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const agentURI = `${baseUrl}/api/v1/agents/${auth.agentId}`;
  const { to, data } = buildMintIdentityData(agentURI);

  return NextResponse.json({
    to,
    data,
    value: "0",
    chain_id: BSC_CHAIN_ID,
    instructions:
      "Sign and submit this transaction with your wallet, then call POST /api/v1/agents/confirm-mint with { tx_hash }",
  });
}
