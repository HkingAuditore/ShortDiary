import { z } from "zod";

/**
 * AI 输出校验。所有 JSON 输出先过 schema，
 * 失败则换「更严格的 JSON 提示」重试一次，再失败回退纯文本并标记 low_confidence。
 */

const annotationShape = z.object({
  /**
   * 朋友读完后的即时反应，不是摘要。
   * min(1)：模型吐空串/纯空白也要算失败 —— 否则会存出「只有 topics、正文为空」的附注，
   * 前端 showAi 因 topics 为真而渲染出一个空便签。
   */
  reaction: z.string().trim().min(1).max(300),
  topics: z.array(z.string().max(24)).max(5).default([]),
  tagSuggestions: z
    .array(z.object({ name: z.string().max(24), confidence: z.number().min(0).max(1) }))
    .max(6)
    .default([]),
  mood: z.object({ label: z.string().max(16), confidence: z.number().min(0).max(1) }).optional(),
});

/** 模型给正文字段起过的名字：实测 deepseek-flash 用过 reply，a2 及更早叫 summary */
const REACTION_KEYS = ["reaction", "reply", "response", "note", "comment", "remark", "thought", "summary", "text"];
/** tagSuggestions 项里标签名的候选键：实测模型用过 tag */
const TAG_NAME_KEYS = ["name", "tag", "label", "title"];

/**
 * 把模型的自由发挥归一到约定键名。
 * 不归一的话：校验失败 → 重试一次 → 仍失败 → 网关回退返回裸 JSON → 存出「只有 topics」的空附注。
 */
function normalizeAnnotation(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...o };

  if (typeof out.reaction !== "string") {
    for (const key of REACTION_KEYS) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) {
        out.reaction = v;
        break;
      }
    }
  }

  if (Array.isArray(o.tagSuggestions)) {
    out.tagSuggestions = (o.tagSuggestions as unknown[]).map((item) => {
      if (!item || typeof item !== "object") return item;
      const t = item as Record<string, unknown>;
      if (typeof t.name === "string") return t;
      for (const key of TAG_NAME_KEYS) {
        if (typeof t[key] === "string") return { ...t, name: t[key] };
      }
      return t;
    });
  }

  return out;
}

export const annotationSchema = z.preprocess(normalizeAnnotation, annotationShape);

/** 给网关「重试时把键名写清楚用」的形状说明 */
export const ANNOTATION_SHAPE_HINT = '{"reaction": "你的反应", "topics": ["词"], "tagSuggestions": [{"name": "标签", "confidence": 0.8}], "mood": {"label": "情绪", "confidence": 0.7}}';

export type AnnotationOutput = z.infer<typeof annotationShape>;

const idList = z.array(z.string()).max(50).default([]);

export const reviewSchema = z.object({
  summary: z.string().max(2000),
  themes: z.array(z.object({ name: z.string().max(32), count: z.number().int().min(0), entryIds: idList })).max(10).default([]),
  highlights: z.array(z.object({ text: z.string().max(500), entryIds: idList })).max(8).default([]),
  suggestions: z.array(z.object({ text: z.string().max(500), basisEntryIds: idList })).max(6).default([]),
  keywords: z.array(z.string().max(24)).max(12).default([]),
  distribution: z.array(z.object({ name: z.string().max(32), count: z.number().int().min(0) })).max(8).optional(),
  openThreads: z.array(z.object({ text: z.string().max(500), basisEntryIds: idList })).max(6).optional(),
  trajectory: z.array(z.object({ text: z.string().max(500) })).max(6).optional(),
  milestones: z.array(z.object({ text: z.string().max(500), entryIds: idList })).max(8).optional(),
  nextMonth: z.array(z.object({ text: z.string().max(500), basisEntryIds: idList })).max(6).optional(),
  energy: z.object({ label: z.string().max(16), confidence: z.number().min(0).max(1) }).optional(),
});

export type ReviewOutput = z.infer<typeof reviewSchema>;

export const monthlyMapSchema = z.object({
  digest: z.string().max(2000),
  entryIds: z.array(z.string()).max(200).default([]),
});

export const providerImportSchema = z.object({
  name: z.string().min(1).max(60),
  protocol: z.enum(["openai_compatible", "anthropic", "gemini"]),
  base_url: z.string().url().max(300),
  api_key: z.string().min(4).max(500),
  models: z
    .object({
      chat: z.string().min(1).max(120).optional(),
      vision: z.string().min(1).max(120).optional(),
      embedding: z.string().min(1).max(120).optional(),
    })
    .optional(),
  capabilities: z
    .object({ vision: z.boolean().optional(), embedding: z.boolean().optional(), json: z.boolean().optional() })
    .optional(),
});

export type ProviderImport = z.infer<typeof providerImportSchema>;
