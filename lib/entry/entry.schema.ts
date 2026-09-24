import { z } from "zod";
import { ALLOWED_IMAGE_MIMES, MAX_IMAGE_BYTES } from "@/lib/storage/key-convention";

/**
 * 服务端边界校验。要点：
 * - 未知字段默认 strip，客户端传入的 user_id 一律被丢弃（防 IDOR）。
 * - 所有结构同时作为 AI 输出校验的基础类型来源。
 */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD");
const timeString = z.string().regex(/^\d{2}:\d{2}$/, "时间格式应为 HH:mm");

export const assetDescriptorSchema = z.object({
  key: z.string().min(8).max(300),
  mime: z.string().refine((m) => ALLOWED_IMAGE_MIMES.has(m), "不支持的图片格式"),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
  sizeBytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
  blurhash: z.string().max(64).optional(),
  alt: z.string().max(300).optional(),
});

export const createEntrySchema = z.object({
  content: z.string().trim().min(1, "写点什么再发送吧").max(20000),
  /** 「属于哪一天」；缺省为当前时刻所在日 */
  entryDate: dateString.optional(),
  /** 用户声明的发生时刻（ISO）；与 occurredTime 二选一 */
  occurredAt: z.string().datetime().optional(),
  occurredTime: timeString.optional(),
  starred: z.boolean().optional(),
  assets: z.array(assetDescriptorSchema).max(9, "一次最多 9 张图片").optional(),
  tags: z.array(z.string().min(1).max(32)).max(10).optional(),
  source: z.enum(["web", "import"]).optional(),
  /** 幂等键由 Idempotency-Key 头提供，也可在 body 中显式传入 */
});

export const updateEntrySchema = z
  .object({
    content: z.string().trim().min(1).max(20000).optional(),
    entryDate: dateString.optional(),
    occurredAt: z.string().datetime().optional(),
    occurredTime: timeString.optional(),
    starred: z.boolean().optional(),
    assets: z.array(assetDescriptorSchema).max(9).optional(),
    tags: z.array(z.string().min(1).max(32)).max(10).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "没有需要更新的字段");

/** URL query 里的布尔开关："true"/"false"/缺省 → true/false/undefined */
const boolFlag = z.preprocess(
  (v) => (v === undefined || v === "" ? undefined : v === true || v === "true"),
  z.boolean().optional(),
);

export const listEntryQuerySchema = z.object({
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  tag: z.string().max(64).optional(),
  hasImage: boolFlag,
  starred: boolFlag,
  q: z.string().max(120).optional(),
});

export const setEntryTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(32)).max(10),
});

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type AssetDescriptor = z.infer<typeof assetDescriptorSchema>;
export type ListEntryQuery = z.infer<typeof listEntryQuerySchema>;

// ---- 视图 DTO（API 与前端共用）----

export interface EntryAssetView {
  id: string;
  /** 读取地址：本地驱动为 /api/media/<id>，COS 驱动亦经该端点 302 到签名 URL */
  url: string;
  width: number;
  height: number;
  blurhash: string | null;
  alt: string | null;
  mime: string;
  sizeBytes: number;
}

export interface EntryTagView {
  id: string;
  name: string;
  colorToken: string;
  source: string;
}

export interface EntryAiView {
  status: string;
  /** a3 起：朋友读完后的即时反应。旧版本字段 summary 由 mapper 兜底读入 */
  reaction?: string;
  topics?: string[];
  tagSuggestions?: Array<{ name: string; confidence: number }>;
  mood?: { label: string; confidence: number };
}

export interface EntryView {
  id: string;
  content: string;
  entryDate: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  starred: boolean;
  source: string;
  aiStatus: string;
  assets: EntryAssetView[];
  tags: EntryTagView[];
  ai: EntryAiView | null;
}
