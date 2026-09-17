import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import type { DbExecutor } from "@/lib/db/types";
import { assets } from "@/lib/db/schema";
import type { Asset } from "@/lib/db/schema";
import { uuidv7 } from "@/lib/utils/uuid";
import type { AssetDescriptor } from "@/lib/entry/entry.schema";

/**
 * 图片元数据仓储。width/height 必存，用于前端 aspect-ratio 占位（CLS ≈ 0）。
 */

export async function attachAssets(
  userId: string,
  entryId: string,
  descriptors: AssetDescriptor[],
  tx?: DbExecutor,
): Promise<Asset[]> {
  if (descriptors.length === 0) return [];
  const db = tx ?? (await getDb());
  const rows = await db
    .insert(assets)
    .values(
      descriptors.map((d, i) => ({
        id: uuidv7(),
        userId,
        entryId,
        cosKey: d.key,
        mimeType: d.mime,
        width: d.width,
        height: d.height,
        sizeBytes: d.sizeBytes,
        blurhash: d.blurhash ?? null,
        alt: d.alt ?? null,
        sortOrder: i,
        status: "attached",
      })),
    )
    .onConflictDoUpdate({
      target: assets.cosKey,
      set: { entryId, status: "attached", sortOrder: sql`excluded.sort_order` },
    })
    .returning();
  return rows;
}

export async function findAssetById(userId: string, id: string): Promise<Asset | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.userId, userId), isNull(assets.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listAssetsByEntry(userId: string, entryId: string): Promise<Asset[]> {
  const db = await getDb();
  return db
    .select()
    .from(assets)
    .where(and(eq(assets.entryId, entryId), eq(assets.userId, userId), isNull(assets.deletedAt)))
    .orderBy(asc(assets.sortOrder));
}

export async function listPhotos(userId: string, limit = 60, cursor?: string | null): Promise<{ rows: Asset[]; nextCursor: string | null }> {
  const db = await getDb();
  const conditions = [eq(assets.userId, userId), isNull(assets.deletedAt), eq(assets.status, "attached")];
  if (cursor) conditions.push(lt(assets.createdAt, new Date(cursor)));

  const rows = await db
    .select()
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return { rows: page, nextCursor: hasMore && last ? last.createdAt.toISOString() : null };
}

/** 孤儿文件 GC：超过 TTL 仍未被任何 Entry 引用的临时对象 */
export async function findOrphanAssets(olderThanHours = 24, limit = 200): Promise<Asset[]> {
  const db = await getDb();
  return db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.status, "pending"),
        lt(assets.createdAt, sql`now() - ${`${olderThanHours} hours`}::interval`),
      ),
    )
    .limit(limit);
}

export async function markAssetsOrphan(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  await db.update(assets).set({ status: "orphan" }).where(inArray(assets.id, ids));
}

export async function deleteAssets(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  await db.delete(assets).where(inArray(assets.id, ids));
}

export async function countAssets(userId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assets)
    .where(and(eq(assets.userId, userId), isNull(assets.deletedAt)));
  return rows[0]?.n ?? 0;
}
