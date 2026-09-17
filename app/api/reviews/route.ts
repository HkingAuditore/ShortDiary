import type { NextRequest } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { getReviews, requestReview } from "@/lib/review/review.service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(["daily", "weekly", "monthly"]).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const GET = defineRoute(async (req: NextRequest) => {
  const ctx = await serviceContext();
  const url = new URL(req.url);
  const query = querySchema.parse(Object.fromEntries(url.searchParams));
  const list = await getReviews(ctx, query.type, query.limit ?? 30);
  return { data: list };
});

const bodySchema = z.object({
  type: z.enum(["daily", "weekly", "monthly"]),
  anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** 生成复盘：异步任务，返回 reviewId + jobId */
export const POST = defineRoute(
  async (req: NextRequest) => {
    const ctx = await serviceContext();
    const body = bodySchema.parse(await req.json());
    const result = await requestReview(ctx, { type: body.type, anchor: body.anchor ?? null });
    return { data: result, status: 202 };
  },
  { rateLimit: { limit: 20 } },
);
