import { getDb } from "@/lib/db/client";
import { assets, entries } from "@/lib/db/schema";
import type { Entry } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  countEntries,
  createEntry as repoCreate,
  findEntryById,
  listDeletedEntries,
  purgeEntry,
  restoreEntry,
  softDeleteEntry,
  updateEntry as repoUpdate,
} from "./entry.repo";
import { attachAssets as repoAttach } from "@/lib/asset/asset.repo";
import { setEntryTags } from "@/lib/tag/tag.repo";
import { kickWorker } from "@/lib/jobs/runner";
import { fetchEntryById, fetchTimelinePage } from "@/lib/db/queries/timeline";
import { mapTimelineRow } from "./entry.mapper";
import type { CreateEntryInput, EntryView, ListEntryQuery, UpdateEntryInput } from "./entry.schema";
import { AppError } from "@/lib/errors/app-error";
import { enqueue } from "@/lib/jobs/queue";
import { contentHash } from "@/lib/utils/hash";
import { combineDateTime, dateInTimeZone } from "@/lib/utils/date";
import { encodeCursor } from "@/lib/utils/cursor";
import { logger } from "@/lib/obs/logger";

/**
 * 业务规则与编排层。不依赖 NextRequest/Response，不读 cookie。
 * 多步写入一律包在事务里。
 */

export interface ServiceContext {
  userId: string;
  timezone: string;
  preferences?: { autoAnnotate?: boolean };
}

export interface TimelinePage {
  items: EntryView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function listEntries(ctx: ServiceContext, query: ListEntryQuery): Promise<TimelinePage> {
  const { rows, hasMore } = await fetchTimelinePage({
    userId: ctx.userId,
    cursor: query.cursor ?? null,
    limit: query.limit ?? 30,
    from: query.from,
    to: query.to,
    tag: query.tag,
    hasImage: query.hasImage === true,
    starred: query.starred === true,
    q: query.q,
  });

  const items = rows.map((r) => mapTimelineRow(r as never));
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ entryDate: last.entryDate, createdAt: last.createdAt, id: last.id }) : null;

  return { items, nextCursor, hasMore };
}

export async function getEntry(ctx: ServiceContext, id: string): Promise<EntryView | null> {
  const row = await fetchEntryById(ctx.userId, id);
  return row ? mapTimelineRow(row as never) : null;
}

export async function createEntry(ctx: ServiceContext, input: CreateEntryInput): Promise<EntryView> {
  const db = await getDb();

  // 只有「补记过去某天」或「明确给了时刻」才做墙钟换算；
  // 顺手的当下记录用真实当前时刻 —— 否则所有当天记录都会显示成同一个换算时刻。
  const nowStr = dateInTimeZone(new Date(), ctx.timezone);
  const entryDateInput = input.entryDate;
  const isBackfill =
    entryDateInput !== undefined &&
    (input.occurredTime !== undefined || entryDateInput !== nowStr);
  const occurredAt = input.occurredAt
    ? new Date(input.occurredAt)
    : entryDateInput && isBackfill
      ? combineDateTime(entryDateInput, input.occurredTime ?? null, ctx.timezone)
      : new Date();

  // 「属于哪一天」与「真正写入时间」分离：补记昨天不改变 created_at
  const entryDate = input.entryDate ?? dateInTimeZone(occurredAt, ctx.timezone);

  const created = await db.transaction(async (tx) => {
    const entry = await repoCreate(
      ctx.userId,
      { content: input.content, entryDate, occurredAt, starred: input.starred ?? false, source: input.source ?? "web" },
      tx as never,
    );
    if (input.assets?.length) await repoAttach(ctx.userId, entry.id, input.assets, tx as never);
    if (input.tags?.length) await setEntryTags(ctx.userId, entry.id, input.tags, "manual", tx as never);
    // 不跑 AI 整理时直接落为 skipped：repo 默认写 pending，但这里不会入队，
    // 没有任务会推进它，前端会永远显示「AI 整理中」
    if (ctx.preferences?.autoAnnotate === false) {
      await tx.update(entries).set({ aiStatus: "skipped" }).where(eq(entries.id, entry.id));
    }
    return entry;
  });

  // AI 整理是后台任务，不阻塞「发送成功」
  if (ctx.preferences?.autoAnnotate !== false) {
    void enqueue({
      type: "ai_annotate",
      payload: { entryId: created.id, userId: ctx.userId },
      idempotencyKey: `annotate:${created.id}`,
    })
      .then(() => kickWorker())
      .catch((err) => logger.warn({ err }, "AI 整理任务入队失败"));
  }

  return (await getEntry(ctx, created.id))!;
}

export async function updateEntry(ctx: ServiceContext, id: string, input: UpdateEntryInput): Promise<EntryView> {
  const db = await getDb();
  const existing = await findEntryById(ctx.userId, id);
  if (!existing || existing.deletedAt) throw AppError.notFound("记录不存在或已删除");

  const patch: Record<string, unknown> = {};
  if (input.content !== undefined) patch.content = input.content;
  if (input.starred !== undefined) patch.starred = input.starred;
  if (input.entryDate !== undefined) patch.entryDate = input.entryDate;
  if (input.occurredAt !== undefined) patch.occurredAt = new Date(input.occurredAt);
  else if (input.occurredTime !== undefined) {
    patch.occurredAt = combineDateTime(input.entryDate ?? existing.entryDate, input.occurredTime, ctx.timezone);
  }

  await db.transaction(async (tx) => {
    if (Object.keys(patch).length > 0) await repoUpdate(ctx.userId, id, patch as never, tx as never);
    if (input.assets) {
      await tx.update(assets).set({ deletedAt: new Date(), status: "orphan" }).where(eq(assets.entryId, id));
      await repoAttach(ctx.userId, id, input.assets, tx as never);
    }
    if (input.tags) await setEntryTags(ctx.userId, id, input.tags, "manual", tx as never);
  });

  // 内容变更后 AI 缓存键失效，需要重新整理
  if (input.content !== undefined && input.content !== existing.content) {
    void enqueue({
      type: "ai_annotate",
      payload: { entryId: id, userId: ctx.userId },
      idempotencyKey: `annotate:${id}:${contentHash(id, input.content)}`,
    })
      .then(() => kickWorker())
      .catch(() => undefined);
  }

  return (await getEntry(ctx, id))!;
}

export async function softDelete(ctx: ServiceContext, id: string): Promise<{ ok: boolean }> {
  if (!(await softDeleteEntry(ctx.userId, id))) throw AppError.notFound("记录不存在或已删除");
  return { ok: true };
}

export async function restore(ctx: ServiceContext, id: string): Promise<{ ok: boolean }> {
  if (!(await restoreEntry(ctx.userId, id))) {
    throw AppError.notFound("记录不存在，或已超过 30 分钟撤销窗口");
  }
  return { ok: true };
}

export async function purge(ctx: ServiceContext, id: string): Promise<{ ok: boolean }> {
  await purgeEntry(ctx.userId, id);
  return { ok: true };
}

export async function trash(ctx: ServiceContext): Promise<EntryView[]> {
  const rows = await listDeletedEntries(ctx.userId);
  return rows.map((e) => ({
    id: e.id,
    content: e.content,
    entryDate: e.entryDate,
    occurredAt: e.occurredAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    starred: e.starred,
    source: e.source,
    aiStatus: e.aiStatus,
    assets: [],
    tags: [],
    ai: null,
  }));
}

export async function stats(ctx: ServiceContext): Promise<{ entryCount: number; assetCount: number }> {
  const { countAssets } = await import("@/lib/asset/asset.repo");
  return { entryCount: await countEntries(ctx.userId), assetCount: await countAssets(ctx.userId) };
}

export function isOwned(entry: Entry, userId: string): boolean {
  return entry.userId === userId && !entry.deletedAt;
}

export { entries };
