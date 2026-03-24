import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getIdentitiesForWallet } from "@/lib/bsc/erc8004";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (!auth.walletAddress) {
    return NextResponse.json(
      { error: "No wallet address associated with this agent" },
      { status: 400 }
    );
  }

  const identities = await getIdentitiesForWallet(auth.walletAddress);

  return NextResponse.json({
    identities: identities.map((id) => ({
      token_id: id.tokenId.toString(),
      token_uri: id.tokenURI,
      owner: id.owner,
    })),
  });
}
