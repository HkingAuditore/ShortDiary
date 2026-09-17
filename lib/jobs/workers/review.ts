import type { Job } from "@/lib/db/schema";
import { fetchEntriesForReview } from "@/lib/db/queries/timeline";
import { completeReview, failReview, findReview, upsertPending } from "@/lib/review/review.repo";
import { dailyMessages, DAILY_PROMPT_VERSION, monthlyMapMessages, monthlyReduceMessages, MONTHLY_PROMPT_VERSION, weeklyMessages, WEEKLY_PROMPT_VERSION } from "@/lib/ai/prompts/review";
import { monthlyMapSchema, reviewSchema } from "@/lib/ai/schemas";
import { runGateway } from "@/lib/ai/gateway";
import { jobLogger } from "@/lib/obs/logger";
import type { ReviewSourceEntry } from "@/lib/db/queries/timeline";

/**
 * 复盘生成。月复盘走 Map-Reduce：先分段压缩，再汇总，
 * 避免整月原文一次性塞进上下文导致失败或昂贵。
 */

type ReviewType = "daily" | "weekly" | "monthly";

function versionOf(type: ReviewType): string {
  return type === "daily" ? DAILY_PROMPT_VERSION : type === "weekly" ? WEEKLY_PROMPT_VERSION : MONTHLY_PROMPT_VERSION;
}

export async function runReviewJob(job: Job): Promise<void> {
  const payload = job.payload as { userId?: string; type?: string; startDate?: string; endDate?: string };
  const userId = payload.userId;
  const type = payload.type as ReviewType | undefined;
  const startDate = payload.startDate;
  const endDate = payload.endDate;

  if (!userId || !type || !startDate || !endDate) throw new Error("review job 参数不完整");
  const version = versionOf(type);

  const review = await upsertPending({ userId, type, startDate, endDate, promptVersion: version, model: "" });

  try {
    const entries = await fetchEntriesForReview(userId, startDate, endDate);
    if (entries.length === 0) {
      jobLogger.info({ jobId: job.id, reviewId: review.id, type, startDate }, "复盘区间内没有记录，产出空复盘");
      await completeReview(review.id, emptyReview(startDate, endDate), null, "");
      return;
    }

    let json: unknown;
    let model = "";
    let providerId: string | null = null;

    if (type === "monthly") {
      const chunks = chunkEntries(entries, 8);
      const digests: string[] = [];
      for (const chunk of chunks) {
        const mapResult = await runGateway({
          userId,
          task: "review",
          messages: monthlyMapMessages(chunk.map(toReviewInput)),
          schema: monthlyMapSchema,
          jsonMode: true,
          timeoutMs: 120_000,
        });
        const parsed = mapResult.json as { digest?: string } | null;
        digests.push(parsed?.digest ?? chunk.map((e) => e.content).join("\n").slice(0, 400));
        model = mapResult.model;
        providerId = mapResult.providerId;
      }

      const reduced = await runGateway({
        userId,
        task: "review",
        messages: monthlyReduceMessages({ yearMonth: startDate.slice(0, 7), digests }),
        schema: reviewSchema,
        jsonMode: true,
        timeoutMs: 180_000,
      });
      json = reduced.json ?? { summary: digests.join("\n\n") };
      model = reduced.model;
      providerId = reduced.providerId;
    } else {
      const messages =
        type === "daily"
          ? dailyMessages({ date: startDate, entries: entries.map(toReviewInput), moodEnabled: true })
          : weeklyMessages({ startDate, endDate, entries: entries.map(toReviewInput) });

      const result = await runGateway({ userId, task: "review", messages, schema: reviewSchema, jsonMode: true, timeoutMs: 180_000 });
      json = result.json ?? { summary: result.text };
      model = result.model;
      providerId = result.providerId;
    }

    await completeReview(review.id, json, providerId, model);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failReview(review.id, message.slice(0, 300));
    throw err;
  }
}

function toReviewInput(e: ReviewSourceEntry) {
  return { id: e.id, entryDate: e.entryDate, time: e.time, content: e.content, summary: e.summary ?? undefined };
}

function chunkEntries<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function emptyReview(startDate: string, endDate: string) {
  return { summary: `${startDate} ~ ${endDate} 期间没有记录。`, themes: [], highlights: [], suggestions: [], keywords: [] };
}

export async function reviewExists(userId: string, type: string, startDate: string): Promise<boolean> {
  const version = versionOf(type as ReviewType);
  return Boolean(await findReview(userId, type, startDate, version));
}

export { versionOf };
