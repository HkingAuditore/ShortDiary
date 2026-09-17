import type { NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { getDb } from "@/lib/db/client";
import { assets, entries } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().positive().max(60).optional(),
});

export interface PhotoView {
  id: string;
  url: string;
  width: number;
  height: number;
  blurhash: string | null;
  entryId: string;
  entryDate: string;
  createdAt: string;
}

/** 相册：游标分页，全部走 (user_id, created_at DESC) 索引 */
export const GET = defineRoute(async (req: NextRequest) => {
  const ctx = await serviceContext();
  const url = new URL(req.url);
  const query = querySchema.parse(Object.fromEntries(url.searchParams));
  const limit = query.limit ?? 60;

  const db = await getDb();
  const conditions = [eq(assets.userId, ctx.userId), isNull(assets.deletedAt), eq(assets.status, "attached")];
  if (query.cursor) conditions.push(lt(assets.createdAt, new Date(query.cursor)));

  const rows = await db
    .select({
      id: assets.id,
      width: assets.width,
      height: assets.height,
      blurhash: assets.blurhash,
      createdAt: assets.createdAt,
      entryId: assets.entryId,
      entryDate: entries.entryDate,
    })
    .from(assets)
    .innerJoin(entries, eq(entries.id, assets.entryId))
    .where(and(...conditions))
    .orderBy(desc(assets.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  const items: PhotoView[] = page.map((r) => ({
    id: r.id,
    url: `/api/media/${r.id}`,
    width: r.width,
    height: r.height,
    blurhash: r.blurhash,
    entryId: r.entryId ?? "",
    entryDate: r.entryDate,
    createdAt: r.createdAt.toISOString(),
  }));

  return {
    data: items,
    meta: { nextCursor: hasMore && last ? last.createdAt.toISOString() : undefined, hasMore },
  };
});
