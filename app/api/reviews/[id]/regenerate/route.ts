import type { NextRequest } from "next/server";
import { defineRoute, type RouteCtx } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { regenerateReview } from "@/lib/review/review.service";

export const dynamic = "force-dynamic";

export const POST = defineRoute(
  async (_req: NextRequest, ctx: RouteCtx) => {
    const sctx = await serviceContext();
    const result = await regenerateReview(sctx, ctx.params.id ?? "");
    return { data: result, status: 202 };
  },
  { rateLimit: { limit: 20 } },
);
