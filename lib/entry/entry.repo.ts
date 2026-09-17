import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import type { DbExecutor } from "@/lib/db/types";
import { assets, entries, entryTags, tags } from "@/lib/db/schema";
import type { Entry } from "@/lib/db/schema";
import { uuidv7 } from "@/lib/utils/uuid";
import { sha256 } from "@/lib/utils/hash";

/**
 * 唯一允许接触 Drizzle 的地方之一。
 * 硬约束：每个函数的首参必为 userId，类型层面无法省略 —— 这是多用户隔离的第一道防线。
 */

export interface NewEntry {
  content: string;
  entryDate: string;
  occurredAt: Date;
  starred?: boolean;
  source?: string;
}

export async function createEntry(userId: string, input: NewEntry, tx?: DbExecutor): Promise<Entry> {
  const db = tx ?? (await getDb());
  const [row] = await db
    .insert(entries)
    .values({
      id: uuidv7(),
      userId,
      content: input.content,
      contentHash: sha256(input.content),
      entryDate: input.entryDate,
      occurredAt: input.occurredAt,
      starred: input.starred ?? false,
      source: input.source ?? "web",
      aiStatus: "pending",
    })
    .returning();
  if (!row) throw new Error("创建记录失败");
  return row;
}

export async function findEntryById(userId: string, id: string, tx?: DbExecutor): Promise<Entry | null> {
  const db = tx ?? (await getDb());
  const rows = await db
    .select()
    .from(entries)
    .where(and(eq(entries.id, id), eq(entries.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateEntry(
  userId: string,
  id: string,
  patch: Partial<Pick<Entry, "content" | "entryDate" | "occurredAt" | "starred" | "aiStatus">> & { contentHash?: string },
  tx?: DbExecutor,
): Promise<Entry | null> {
  const db = tx ?? (await getDb());
  const next: Record<string, unknown> = { ...patch };
  if (patch.content !== undefined) next.contentHash = sha256(patch.content);
  if (Object.keys(next).length === 0) return findEntryById(userId, id, tx);

  const rows = await db
    .update(entries)
    .set(next)
    .where(and(eq(entries.id, id), eq(entries.userId, userId), isNull(entries.deletedAt)))
    .returning();
  return rows[0] ?? null;
}

/** 软删除：保留 COS 文件，30 分钟内可撤销 */
export async function softDeleteEntry(userId: string, id: string, tx?: DbExecutor): Promise<boolean> {
  const db = tx ?? (await getDb());
  const rows = await db
    .update(entries)
    .set({ deletedAt: new Date() })
    .where(and(eq(entries.id, id), eq(entries.userId, userId), isNull(entries.deletedAt)))
    .returning({ id: entries.id });
  return rows.length > 0;
}

export async function restoreEntry(userId: string, id: string, withinMinutes = 30, tx?: DbExecutor): Promise<boolean> {
  const db = tx ?? (await getDb());
  const rows = await db
    .update(entries)
    .set({ deletedAt: null })
    .where(
      and(
        eq(entries.id, id),
        eq(entries.userId, userId),
        sql`deleted_at IS NOT NULL AND deleted_at > now() - ${`${withinMinutes} minutes`}::interval`,
      ),
    )
    .returning({ id: entries.id });
  return rows.length > 0;
}

export async function listDeletedEntries(userId: string, limit = 50): Promise<Entry[]> {
  const db = await getDb();
  return db
    .select()
    .from(entries)
    .where(and(eq(entries.userId, userId), sql`deleted_at IS NOT NULL`))
    .orderBy(sql`deleted_at DESC`)
    .limit(limit);
}

/** 永久删除（清空回收站）：同时清理关联行，COS 文件由 GC 处理 */
export async function purgeEntry(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.delete(entryTags).where(eq(entryTags.entryId, id));
  await db.update(assets).set({ deletedAt: new Date(), status: "orphan" }).where(eq(assets.entryId, id));
  await db.delete(entries).where(and(eq(entries.id, id), eq(entries.userId, userId)));
}

export async function countEntries(userId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(entries)
    .where(and(eq(entries.userId, userId), isNull(entries.deletedAt)));
  return rows[0]?.n ?? 0;
}

export async function findEntriesByIds(userId: string, ids: string[]): Promise<Entry[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  return db
    .select()
    .from(entries)
    .where(and(eq(entries.userId, userId), inArray(entries.id, ids), isNull(entries.deletedAt)))
    .orderBy(sql`entry_date ASC, created_at ASC`);
}

/** 供「随机回忆」使用：从含图/星标记录中抽取 */
export async function randomMemories(userId: string, limit = 5): Promise<Entry[]> {
  const db = await getDb();
  return db
    .select()
    .from(entries)
    .where(and(eq(entries.userId, userId), isNull(entries.deletedAt), eq(entries.starred, true)))
    .orderBy(sql`random()`)
    .limit(limit);
}

export async function entryHasTag(userId: string, entryId: string, tagId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ id: entryTags.entryId })
    .from(entryTags)
    .innerJoin(tags, eq(tags.id, entryTags.tagId))
    .where(and(eq(entryTags.entryId, entryId), eq(entryTags.tagId, tagId), eq(tags.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
