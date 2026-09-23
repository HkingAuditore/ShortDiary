import { AppError } from "@/lib/errors/app-error";
import { enqueue } from "@/lib/jobs/queue";
import { kickWorker } from "@/lib/jobs/runner";
import { findReviewById, listReviews as repoList, upsertPending } from "./review.repo";
import { versionOf } from "@/lib/jobs/workers/review";
import { endOfMonth, endOfWeek, startOfMonth, startOfWeek, today } from "@/lib/utils/date";
import type { ServiceContext } from "@/lib/entry/entry.service";

/**
 * 复盘编排。生成一律走后台任务：月复盘可能耗时数分钟，不能挂在请求里。
 */

export type ReviewType = "daily" | "weekly" | "monthly";

export interface ReviewRequest {
  type: ReviewType;
  startDate: string;
  endDate: string;
}

export function resolveRange(type: ReviewType, anchor: string | null, timezone: string): ReviewRequest {
  const base = anchor ?? today(timezone);
  if (type === "daily") return { type, startDate: base, endDate: base };
  if (type === "weekly") return { type, startDate: startOfWeek(base), endDate: endOfWeek(base) };
  return { type, startDate: startOfMonth(base), endDate: endOfMonth(base) };
}

export async function requestReview(ctx: ServiceContext, input: { type: ReviewType; anchor?: string | null }) {
  if (!["daily", "weekly", "monthly"].includes(input.type)) {
    throw AppError.invalidInput("复盘类型只支持 daily / weekly / monthly");
  }
  const range = resolveRange(input.type, input.anchor ?? null, ctx.timezone);
  const version = versionOf(input.type);

  const review = await upsertPending({
    userId: ctx.userId,
    type: input.type,
    startDate: range.startDate,
    endDate: range.endDate,
    promptVersion: version,
    model: "",
  });

  const { id: jobId, deduped } = await enqueue({
    type: "review_generate",
    payload: { userId: ctx.userId, type: input.type, startDate: range.startDate, endDate: range.endDate },
    idempotencyKey: `review:${ctx.userId}:${input.type}:${range.startDate}:${version}`,
    maxAttempts: 2,
  });
  kickWorker();

  return { reviewId: review.id, jobId, deduped, ...range, status: review.status };
}

/** 重生成：换模型/换 prompt 版本都产生新结果，原文不受影响 */
export async function regenerateReview(ctx: ServiceContext, reviewId: string) {
  const review = await findReviewById(ctx.userId, reviewId);
  if (!review) throw AppError.notFound("复盘不存在");

  await enqueue({
    type: "review_generate",
    payload: {
      userId: ctx.userId,
      type: review.type,
      startDate: review.startDate,
      endDate: review.endDate,
    },
    idempotencyKey: `review:${ctx.userId}:${review.type}:${review.startDate}:${review.promptVersion}:${Date.now()}`,
    maxAttempts: 2,
  });
  kickWorker();

  return { reviewId: review.id, status: "pending" };
}

export async function getReviews(ctx: ServiceContext, type?: string, limit = 30) {
  return repoList(ctx.userId, type, limit);
}

export async function getReview(ctx: ServiceContext, id: string) {
  const review = await findReviewById(ctx.userId, id);
  if (!review) throw AppError.notFound("复盘不存在");
  return review;
}
