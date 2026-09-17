import type { NextRequest } from "next/server";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { withIdempotency } from "@/lib/api/idempotency";
import { listEntries, createEntry } from "@/lib/entry/entry.service";
import { createEntrySchema, listEntryQuerySchema } from "@/lib/entry/entry.schema";

export const dynamic = "force-dynamic";

/** 时间线：游标分页，禁止 OFFSET */
export const GET = defineRoute(async (req: NextRequest) => {
  const ctx = await serviceContext();
  const url = new URL(req.url);
  const query = listEntryQuerySchema.parse(Object.fromEntries(url.searchParams));

  const page = await listEntries(ctx, query);
  return {
    data: page.items,
    meta: { nextCursor: page.nextCursor ?? undefined, hasMore: page.hasMore },
  };
});

/** 创建记录：文本 + 图片描述符 + 标签，事务写入 */
export const POST = defineRoute(
  async (req: NextRequest) => {
    const ctx = await serviceContext();
    const body = createEntrySchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");

    const { result } = await withIdempotency(key, () => createEntry(ctx, body));
    return { data: result, status: 201 };
  },
  { rateLimit: { limit: 120 } },
);
