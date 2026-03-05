import { NextRequest, NextResponse } from "next/server";
import { validatedRoute } from "@/lib/utils/validated-route";
import { challengeSchema } from "@/lib/validators";
import { createChallenge } from "@/lib/services/challenge";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { getClientIp } from "@/lib/services/audit";

export const POST = validatedRoute(
  { body: challengeSchema },
  async (req: NextRequest, { body }) => {
    const ip = getClientIp(req);
    const { blocked: rl } = await checkRateLimit(ip, "auth");
    if (rl) return rl;

    const result = await createChallenge(body.wallet_address, body.action);

    return NextResponse.json(result, { status: 200 });
  }
);
