import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { createBountySchema } from "@/lib/validators";
import { createBounty, listBounties } from "@/lib/services/bounty";
import { parsePagination } from "@/lib/utils/pagination";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { getNonce, validateNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";

// GET — List bounties
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);

  const bounties = await listBounties({
    status: sp.get("status") || undefined,
    sort: sp.get("sort") || undefined,
    limit,
    offset,
  });

  return NextResponse.json(bounties);
}

// POST — Create bounty
export const POST = validatedRoute(
  { body: createBountySchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "financial");
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "sensitive");
    if (rl) return rl;

    const nonce = getNonce(req);
    if (nonce) {
      const nonceResult = await validateNonce(auth.agentId, nonce);
      if (nonceResult) return nonceResult;
    }

    try {
      const bounty = await createBounty({
        creatorAgentId: auth.agentId,
        title: body.title,
        description: body.description,
        reward: body.reward,
        tags: body.tags,
        maxClaims: body.max_claims,
        deadlineDays: body.deadline_days,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "create_bounty",
        resourceType: "bounty",
        resourceId: bounty.id,
        metadata: { title: body.title, reward: body.reward },
        ipAddress: getClientIp(req),
      });

      return NextResponse.json(
        {
          ...bounty,
          next_actions: getNextActions("bounty_created", { bounty_id: bounty.id }),
        },
        { status: 201 }
      );
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
