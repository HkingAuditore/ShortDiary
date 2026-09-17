import type { NextRequest } from "next/server";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { listEntries } from "@/lib/entry/entry.service";
import { listEntryQuerySchema } from "@/lib/entry/entry.schema";

export const dynamic = "force-dynamic";

/**
 * 搜索：关键词（pg_trgm GIN / ILIKE）+ 日期 + 标签 + 含图 + 星标，
 * 各条件可独立也可组合，筛选状态由前端写入 URL query。
 */
export const GET = defineRoute(async (req: NextRequest) => {
  const ctx = await serviceContext();
  const url = new URL(req.url);
  const query = listEntryQuerySchema.parse(Object.fromEntries(url.searchParams));

  const page = await listEntries(ctx, { ...query, limit: query.limit ?? 20 });
  return {
    data: page.items,
    meta: { nextCursor: page.nextCursor ?? undefined, hasMore: page.hasMore },
  };
});
