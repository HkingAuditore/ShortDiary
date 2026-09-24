import type { NextRequest } from "next/server";
import { defineRoute, type RouteCtx } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { deleteReview } from "@/lib/review/review.service";

export const dynamic = "force-dynamic";

/** 删除复盘：物理删除，同时撤掉排队中的生成任务 */
export const DELETE = defineRoute(
  async (_req: NextRequest, ctx: RouteCtx) => {
    const sctx = await serviceContext();
    const result = await deleteReview(sctx, ctx.params.id ?? "");
    return { data: result };
  },
  { rateLimit: { limit: 30 } },
);
