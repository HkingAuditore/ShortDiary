import { isAiPending } from "./ai-status";
import type { EntryAiView, EntryAssetView, EntryTagView, EntryView } from "./entry.schema";

interface RawAsset {
  id: string;
  cosKey: string;
  mime: string;
  w: number;
  h: number;
  /** 兼容直接以 width/height 返回的行（如未走 json_build_object 别名的查询） */
  width?: number;
  height?: number;
  blurhash: string | null;
  alt: string | null;
  sizeBytes: number;
}

interface RawTag {
  id: string;
  name: string;
  colorToken: string;
  source: string;
}

interface RawAi {
  type: string;
  content: unknown;
  model: string;
  promptVersion: string;
}

export interface RawTimelineRow {
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

function toIso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * 取附注正文。除了约定键 reaction，还认历史上模型自创/旧版本用过的键名
 * （实测 deepseek-flash 吐过 reply，a2 及更早叫 summary），否则这些记录会显示成空便签。
 * 空白串一律视为没有。
 */
const REACTION_KEYS = ["reaction", "reply", "response", "note", "comment", "summary"];

function reactionOf(c: Record<string, unknown>): string | undefined {
  for (const key of REACTION_KEYS) {
    const v = c[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function buildAiView(rows: RawAi[], status: string): EntryAiView | null {
  const annotation = rows.find((r) => r.type === "annotation");
  if (!annotation) {
    // 还挂在队列上的（含手动重跑的 queued）如实回传状态，界面据此显示「正在读」并继续轮询；
    // 只有真正不会再有产出的状态才归为 skipped
    return isAiPending(status) ? { status } : { status: "skipped" };
  }
  const c = (annotation.content ?? {}) as Record<string, unknown>;
  return {
    status: "completed",
    reaction: reactionOf(c),
    topics: Array.isArray(c.topics) ? (c.topics as string[]) : undefined,
    tagSuggestions: Array.isArray(c.tagSuggestions) ? (c.tagSuggestions as EntryAiView["tagSuggestions"]) : undefined,
    mood: c.mood as EntryAiView["mood"],
  };
}

export function mapTimelineRow(row: RawTimelineRow): EntryView {
  const assets = asArray<RawAsset>(row.assets).map<EntryAssetView>((a) => ({
    id: a.id,
    // 统一走 /api/media/<assetId>：本地驱动直接流式返回，COS 驱动 302 到短期签名 URL
    url: `/api/media/${a.id}`,
    width: a.w ?? a.width ?? 0,
    height: a.h ?? a.height ?? 0,
    blurhash: a.blurhash ?? null,
    alt: a.alt ?? null,
    mime: a.mime ?? "image/webp",
    sizeBytes: a.sizeBytes ?? 0,
  }));

  const tags = asArray<RawTag>(row.tags).map<EntryTagView>((t) => ({
    id: t.id,
    name: t.name,
    colorToken: t.colorToken ?? "sage",
    source: t.source ?? "manual",
  }));

  const ai = buildAiView(asArray<RawAi>(row.ai), row.ai_status);

  return {
    id: row.id,
    content: row.content,
    entryDate: typeof row.entry_date === "string" ? row.entry_date : String(row.entry_date).slice(0, 10),
    occurredAt: toIso(row.occurred_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    starred: Boolean(row.starred),
    source: row.source,
    aiStatus: row.ai_status,
    assets,
    tags,
    ai,
  };
}
