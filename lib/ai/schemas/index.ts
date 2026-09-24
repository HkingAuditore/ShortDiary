import { z } from "zod";

/**
 * AI 输出校验。所有 JSON 输出先过 schema，
 * 失败则换「更严格的 JSON 提示」重试一次，再失败回退纯文本并标记 low_confidence。
 */

const annotationShape = z.object({
  /** 朋友读完后的即时反应，不是摘要 */
  reaction: z.string().max(300),
  topics: z.array(z.string().max(24)).max(5).default([]),
  tagSuggestions: z
    .array(z.object({ name: z.string().max(24), confidence: z.number().min(0).max(1) }))
    .max(6)
    .default([]),
  mood: z.object({ label: z.string().max(16), confidence: z.number().min(0).max(1) }).optional(),
});

/** 兼容模型偶尔仍吐旧字段名 summary（a2 及更早），否则会直接校验失败导致 job 失败 */
export const annotationSchema = z.preprocess((raw) => {
  if (raw && typeof raw === "object" && !("reaction" in raw) && "summary" in raw) {
    const { summary, ...rest } = raw as Record<string, unknown>;
    return { ...rest, reaction: summary };
  }
  return raw;
}, annotationShape);

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
