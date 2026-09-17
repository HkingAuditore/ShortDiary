import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import type { DbExecutor } from "@/lib/db/types";
import { entryTags, tags } from "@/lib/db/schema";
import type { Tag } from "@/lib/db/schema";
import { uuidv7 } from "@/lib/utils/uuid";

/**
 * 标签仓储。同用户下标签名唯一（UNIQUE(user_id, name)），避免重复膨胀。
 */

const COLOR_TOKENS = ["sage", "sun", "rose", "sky", "ink"] as const;

function pickColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return COLOR_TOKENS[hash % COLOR_TOKENS.length] ?? "sage";
}

/** 批量 upsert：返回全部（含已存在）标签，保证调用方能拿到 id */
export async function ensureTags(userId: string, names: string[], source = "manual", tx?: DbExecutor): Promise<Tag[]> {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  if (unique.length === 0) return [];
  const db = tx ?? (await getDb());

  await db
    .insert(tags)
    .values(unique.map((name) => ({ id: uuidv7(), userId, name, colorToken: pickColor(name), source })))
    .onConflictDoNothing({ target: [tags.userId, tags.name] });

  return db
    .select()
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(tags.name, unique)))
    .orderBy(asc(tags.name));
}

/** 全量替换记录上的标签：人工标签优先，AI 建议不覆盖用户已手动确认的绑定 */
export async function setEntryTags(
  userId: string,
  entryId: string,
  names: string[],
  source = "manual",
  tx?: DbExecutor,
): Promise<Tag[]> {
  const db = tx ?? (await getDb());
  const tagRows = await ensureTags(userId, names, source, db);

  await db.delete(entryTags).where(and(eq(entryTags.entryId, entryId), eq(entryTags.source, source)));
  if (tagRows.length > 0) {
    await db
      .insert(entryTags)
      .values(tagRows.map((t) => ({ entryId, tagId: t.id, source })))
      .onConflictDoNothing();
  }
  return tagRows;
}

export async function listTags(userId: string): Promise<Array<Tag & { usageCount: number }>> {
  const db = await getDb();
  return db
    .select({
      id: tags.id,
      userId: tags.userId,
      name: tags.name,
      colorToken: tags.colorToken,
      source: tags.source,
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt,
      usageCount: sql<number>`(SELECT count(*)::int FROM entry_tags et WHERE et.tag_id = tags.id)`,
    })
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(asc(tags.name));
}

export async function findTagById(userId: string, id: string): Promise<Tag | null> {
  const db = await getDb();
  const rows = await db.select().from(tags).where(and(eq(tags.id, id), eq(tags.userId, userId))).limit(1);
  return rows[0] ?? null;
}

export async function updateTag(userId: string, id: string, patch: { name?: string; colorToken?: string }): Promise<Tag | null> {
  const db = await getDb();
  const rows = await db
    .update(tags)
    .set(patch)
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteTag(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.delete(tags).where(and(eq(tags.id, id), eq(tags.userId, userId))).returning({ id: tags.id });
  return rows.length > 0;
}
