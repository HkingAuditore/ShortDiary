import type { Job } from "@/lib/db/schema";
import { findEntryById, updateEntry } from "@/lib/entry/entry.repo";
import { listAssetsByEntry } from "@/lib/asset/asset.repo";
import { ensureTags } from "@/lib/tag/tag.repo";
import { annotateMessages, ANNOTATE_PROMPT_VERSION } from "@/lib/ai/prompts/annotate";
import { annotationSchema, ANNOTATION_SHAPE_HINT } from "@/lib/ai/schemas";
import { runGateway } from "@/lib/ai/gateway";
import { saveAnnotation } from "@/lib/ai/cache";
import { contentHash } from "@/lib/utils/hash";
import { jobLogger } from "@/lib/obs/logger";

/**
 * 单条记录 AI 整理。
 * 只写 ai_annotations，绝不修改 entry.content —— 原始记录永远是第一数据源。
 */
export async function runAnnotateJob(job: Job): Promise<void> {
  const payload = job.payload as { entryId?: string; userId?: string };
  const entryId = payload.entryId;
  const userId = payload.userId;
  if (!entryId || !userId) throw new Error("annotate job 缺少 entryId/userId");

  const entry = await findEntryById(userId, entryId);
  if (!entry || entry.deletedAt) {
    jobLogger.info({ entryId }, "记录已删除，跳过整理");
    return;
  }

  await updateEntry(userId, entryId, { aiStatus: "running" });

  try {
    const assetRows = await listAssetsByEntry(userId, entryId);
    const imageDescriptions = assetRows.map((a) => a.alt).filter((v): v is string => Boolean(v));

    const inputHash = contentHash(ANNOTATE_PROMPT_VERSION, entry.contentHash, imageDescriptions);

    const result = await runGateway({
      userId,
      task: "annotate",
      messages: annotateMessages({
        content: entry.content,
        entryDate: entry.entryDate,
        imageDescriptions,
        moodEnabled: true,
      }),
      schema: annotationSchema,
      jsonMode: true,
      timeoutMs: 60_000,
      cacheKey: inputHash,
      schemaHint: ANNOTATION_SHAPE_HINT,
    });

    // 网关在两次校验都失败时会把「原始 JSON」原样返回（lowConfidence），
    // 里面可能只有 topics、正文字段缺失 —— 直接存会让前端渲染出一个空便签。
    const parsed = annotationSchema.safeParse(result.json);
    if (!parsed.success) {
      jobLogger.warn({ entryId, lowConfidence: result.lowConfidence, issues: parsed.error.issues.length }, "AI 输出未通过附注校验，不落库");
      throw new Error("AI 输出无法解析为结构化结果");
    }
    const annotation = parsed.data;

    await saveAnnotation({
      entryId,
      userId,
      type: "annotation",
      content: annotation,
      providerId: result.providerId,
      model: result.model,
      promptVersion: ANNOTATE_PROMPT_VERSION,
      inputHash,
    });

    // 候选标签只写入 tags 表作为「AI 建议」，不自动绑定到 entry
    const suggested = annotation.tagSuggestions;
    const confident = suggested.filter((s) => s.confidence >= 0.6).map((s) => s.name);
    if (confident.length > 0) await ensureTags(userId, confident, "ai");

    await updateEntry(userId, entryId, { aiStatus: "completed" });
  } catch (err) {
    await updateEntry(userId, entryId, { aiStatus: "failed" });
    throw err;
  }
}
