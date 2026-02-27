import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest } from "@/lib/auth/middleware";
import { withRateLimitHeaders } from "@/lib/middleware/rate-limit";

type RouteContext = { params?: Promise<Record<string, string>> };

export function validatedRoute<B = unknown>(
  schemas: { body?: z.ZodType<B> },
  handler: (
    req: NextRequest,
    ctx: { body: B; params: Record<string, string> }
  ) => Promise<NextResponse>
) {
  return async (req: NextRequest, routeCtx?: RouteContext) => {
    const params = routeCtx?.params ? await routeCtx.params : {};

    let body: B = undefined as B;
    if (schemas.body) {
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        return badRequest("Invalid JSON body");
      }
      const result = schemas.body.safeParse(raw);
      if (!result.success) {
        const errors = result.error.flatten();
        return NextResponse.json(
          { error: "Validation failed", details: errors.fieldErrors },
          { status: 400 }
        );
      }
      body = result.data;
    }

    const response = await handler(req, { body, params });
    return withRateLimitHeaders(response);
  };
}
