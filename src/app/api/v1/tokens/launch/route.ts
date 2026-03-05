import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { launchTokenSchema } from "@/lib/validators";
import { launchToken } from "@/lib/bsc/fourmeme";
import { db } from "@/lib/db";
import { tokenLaunches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";

// POST — Launch a new token on Four.meme
export const POST = validatedRoute(
  { body: launchTokenSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "financial");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    // Create a pending record
    const [launch] = await db
      .insert(tokenLaunches)
      .values({
        agentId: auth.agentId,
        name: body.name,
        symbol: body.symbol,
        description: body.description,
        imageUrl: body.image_url || null,
        totalSupply: String(body.total_supply),
        raisedAmount: String(body.raised_amount),
        initialBuyBnb: body.initial_buy_bnb,
        label: body.label,
        webUrl: body.web_url || null,
        twitterUrl: body.twitter_url || null,
        telegramUrl: body.telegram_url || null,
      })
      .returning();

    try {
      const result = await launchToken({
        name: body.name,
        symbol: body.symbol,
        description: body.description,
        imageUrl: body.image_url,
        totalSupply: body.total_supply,
        raisedAmount: body.raised_amount,
        initialBuyBnb: body.initial_buy_bnb,
        label: body.label,
        webUrl: body.web_url,
        twitterUrl: body.twitter_url,
        telegramUrl: body.telegram_url,
      });

      // Update record with on-chain data
      const [updated] = await db
        .update(tokenLaunches)
        .set({
          status: "launched",
          txHash: result.txHash,
          tokenAddress: result.tokenAddress,
          fourMemeTokenId: result.tokenId,
          launchedAt: new Date(),
        })
        .where(eq(tokenLaunches.id, launch.id))
        .returning();

      await logAudit({
        agentId: auth.agentId,
        action: "launch_token",
        resourceType: "token_launch",
        resourceId: launch.id,
        metadata: {
          name: body.name,
          symbol: body.symbol,
          tokenAddress: result.tokenAddress,
          txHash: result.txHash,
        },
        ipAddress: getClientIp(req),
      });

      return NextResponse.json(
        {
          ...updated,
          explorer: result.explorer,
          next_actions: getNextActions("token_launched", {
            token_address: result.tokenAddress || "",
          }),
        },
        { status: 201 }
      );
    } catch (err: unknown) {
      // Mark launch as failed
      await db
        .update(tokenLaunches)
        .set({
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        })
        .where(eq(tokenLaunches.id, launch.id));

      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 500 }
      );
    }
  }
);
