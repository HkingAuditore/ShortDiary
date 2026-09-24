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

function buildAiView(rows: RawAi[], status: string): EntryAiView | null {
  const annotation = rows.find((r) => r.type === "annotation");
  if (!annotation) {
    return status === "pending" || status === "running" ? { status } : { status: "skipped" };
  }
  const c = (annotation.content ?? {}) as Partial<EntryAiView>;
  return {
    status: "completed",
    // 兼容 a2 及更早：那时这个字段叫 summary
    reaction:
      typeof c.reaction === "string"
        ? c.reaction
        : typeof (c as { summary?: unknown }).summary === "string"
          ? (c as { summary: string }).summary
          : undefined,
    topics: Array.isArray(c.topics) ? (c.topics as string[]) : undefined,
    tagSuggestions: Array.isArray(c.tagSuggestions) ? (c.tagSuggestions as EntryAiView["tagSuggestions"]) : undefined,
    mood: c.mood,
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
