import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { clampLimit, decodeCursor, type TimelineCursor } from "@/lib/utils/cursor";
import { dbLogger } from "@/lib/obs/logger";

/**
 * 时间线单查询聚合。
 * 一页 30 条若分别查 entries/assets/tags/annotations 会产生 1+30×3 次查询；
 * 改为一次查询 + LATERAL json_agg，全部走索引，p95 目标 ≤ 80ms。
 */

export interface TimelineFilters {
  userId: string;
  cursor?: string | null;
  limit?: number;
  from?: string;
  to?: string;
  tag?: string;
  hasImage?: boolean;
  starred?: boolean;
  q?: string;
}

interface RawTimelineRow {
  id: string;
  content: string;
  entry_date: string;
  occurred_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
  starred: boolean;
  source: string;
  ai_status: string;
  assets: unknown;
  tags: unknown;
  ai: unknown;
}

function keysetCondition(cursor: TimelineCursor): SQL {
  return sql`(e.entry_date, e.created_at, e.id) < (${cursor.entryDate}::date, ${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;
}

function normalizeRows(result: unknown): RawTimelineRow[] {
  if (Array.isArray(result)) return result as RawTimelineRow[];
  const maybe = result as { rows?: RawTimelineRow[] };
  return maybe?.rows ?? [];
}

export async function fetchTimelinePage(filters: TimelineFilters) {
  const db = await getDb();
  const limit = clampLimit(filters.limit, 30, 100);
  const cursor = decodeCursor(filters.cursor);

  const conditions: SQL[] = [sql`e.user_id = ${filters.userId}::uuid`, sql`e.deleted_at IS NULL`];

  if (cursor) conditions.push(keysetCondition(cursor));
  if (filters.from) conditions.push(sql`e.entry_date >= ${filters.from}::date`);
  if (filters.to) conditions.push(sql`e.entry_date <= ${filters.to}::date`);
  if (filters.starred) conditions.push(sql`e.starred`);
  if (filters.tag) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM entry_tags et JOIN tags tg ON tg.id = et.tag_id WHERE et.entry_id = e.id AND tg.name = ${filters.tag})`,
    );
  }
  if (filters.hasImage) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM assets s WHERE s.entry_id = e.id AND s.deleted_at IS NULL)`,
    );
  }
  if (filters.q) {
    // pg_trgm 可用时该条件可走 GIN 索引；不可用时自动退化为顺序过滤
    conditions.push(sql`e.content ILIKE ${"%" + filters.q + "%"}`);
  }

  const where = conditions.reduce((acc, c, i) => (i === 0 ? c : sql`${acc} AND ${c}`));

  const started = Date.now();
  const result = await db.execute(sql`
    SELECT
      e.id, e.content, e.entry_date, e.occurred_at, e.created_at, e.updated_at,
      e.starred, e.source, e.ai_status,
      COALESCE(a.assets, '[]'::json) AS assets,
      COALESCE(t.tags, '[]'::json)   AS tags,
      COALESCE(n.ai, '[]'::json)     AS ai
    FROM entries e
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'id', s.id, 'cosKey', s.cos_key, 'mime', s.mime_type,
               'w', s.width, 'h', s.height, 'blurhash', s.blurhash,
               'alt', s.alt, 'sizeBytes', s.size_bytes
             ) ORDER BY s.sort_order) AS assets
      FROM assets s
      WHERE s.entry_id = e.id AND s.deleted_at IS NULL
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'id', tg.id, 'name', tg.name, 'colorToken', tg.color_token, 'source', et.source
             ) ORDER BY tg.name) AS tags
      FROM entry_tags et JOIN tags tg ON tg.id = et.tag_id
      WHERE et.entry_id = e.id
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'type', an.type, 'content', an.content_json,
               'model', an.model, 'promptVersion', an.prompt_version
             )) AS ai
      FROM ai_annotations an
      WHERE an.entry_id = e.id
    ) n ON true
    WHERE ${where}
    ORDER BY e.entry_date DESC, e.created_at DESC, e.id DESC
    LIMIT ${limit + 1}
  `);

  const rows = normalizeRows(result);
  const elapsed = Date.now() - started;
  if (elapsed > 200) dbLogger.warn({ ms: elapsed }, "时间线查询超过慢查询阈值");

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { rows: page, hasMore, elapsed };
}

/** 单条记录：与时间线共用聚合形状，保证前端拿到一致的 DTO */
export async function fetchEntryById(userId: string, id: string) {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT
      e.id, e.content, e.entry_date, e.occurred_at, e.created_at, e.updated_at,
      e.starred, e.source, e.ai_status,
      COALESCE(a.assets, '[]'::json) AS assets,
      COALESCE(t.tags, '[]'::json)   AS tags,
      COALESCE(n.ai, '[]'::json)     AS ai
    FROM entries e
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'id', s.id, 'cosKey', s.cos_key, 'mime', s.mime_type,
               'w', s.width, 'h', s.height, 'blurhash', s.blurhash,
               'alt', s.alt, 'sizeBytes', s.size_bytes
             ) ORDER BY s.sort_order) AS assets
      FROM assets s WHERE s.entry_id = e.id AND s.deleted_at IS NULL
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'id', tg.id, 'name', tg.name, 'colorToken', tg.color_token, 'source', et.source
             ) ORDER BY tg.name) AS tags
      FROM entry_tags et JOIN tags tg ON tg.id = et.tag_id
      WHERE et.entry_id = e.id
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'type', an.type, 'content', an.content_json,
               'model', an.model, 'promptVersion', an.prompt_version
             )) AS ai
      FROM ai_annotations an WHERE an.entry_id = e.id
    ) n ON true
    WHERE e.id = ${id}::uuid AND e.user_id = ${userId}::uuid
    LIMIT 1
  `);
  return normalizeRows(result)[0] ?? null;
}

export interface CalendarDayStat {
  entryDate: string;
  count: number;
  imageCount: number;
  starred: boolean;
}

export async function fetchCalendarStats(userId: string, from: string, to: string): Promise<CalendarDayStat[]> {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT e.entry_date AS "entryDate",
           COUNT(*)::int AS "count",
           COUNT(s.id)::int AS "imageCount",
           BOOL_OR(e.starred) AS "starred"
    FROM entries e
    LEFT JOIN assets s ON s.entry_id = e.id AND s.deleted_at IS NULL
    WHERE e.user_id = ${userId}::uuid
      AND e.deleted_at IS NULL
      AND e.entry_date BETWEEN ${from}::date AND ${to}::date
    GROUP BY e.entry_date
    ORDER BY e.entry_date
  `);
  return normalizeRows(result) as unknown as CalendarDayStat[];
}

export interface ReviewSourceEntry {
  id: string;
  entryDate: string;
  time: string;
  content: string;
  reaction: string | null;
}

/** 复盘输入：范围内全部记录 + 已有附注（避免重复上传原文） */
export async function fetchEntriesForReview(userId: string, from: string, to: string, limit = 600): Promise<ReviewSourceEntry[]> {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT e.id,
           e.entry_date AS "entryDate",
           to_char(e.occurred_at, 'HH24:MI') AS "time",
           e.content,
           (SELECT COALESCE(an.content_json->>'reaction', an.content_json->>'summary')
              FROM ai_annotations an
             WHERE an.entry_id = e.id AND an.type = 'annotation' LIMIT 1) AS "reaction"
    FROM entries e
    WHERE e.user_id = ${userId}::uuid
      AND e.deleted_at IS NULL
      AND e.entry_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY e.entry_date ASC, e.created_at ASC
    LIMIT ${limit}
  `);
  return normalizeRows(result) as unknown as ReviewSourceEntry[];
}

export interface MemoryCandidate {
  id: string;
  content: string;
  entryDate: string;
  starred: boolean;
  imageCount: number;
}

export async function fetchOnThisDay(userId: string, monthDay: string, excludeYear: string, limit = 6): Promise<MemoryCandidate[]> {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT e.id, e.content, e.entry_date AS "entryDate", e.starred,
           (SELECT COUNT(*)::int FROM assets s WHERE s.entry_id = e.id AND s.deleted_at IS NULL) AS "imageCount"
    FROM entries e
    WHERE e.user_id = ${userId}::uuid
      AND e.deleted_at IS NULL
      AND to_char(e.entry_date, 'MM-DD') = ${monthDay}
      AND to_char(e.entry_date, 'YYYY') <> ${excludeYear}
    ORDER BY e.entry_date DESC
    LIMIT ${limit}
  `);
  return normalizeRows(result) as unknown as MemoryCandidate[];
}
