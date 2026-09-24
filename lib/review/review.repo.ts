import { and, desc, eq, like } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { jobs, reviews } from "@/lib/db/schema";
import type { Review } from "@/lib/db/schema";
import { uuidv7 } from "@/lib/utils/uuid";

/**
 * 复盘仓储。UNIQUE(user_id, type, start_date, prompt_version) 提供幂等：
 * 同一版本不会重复生成，换版本则产生新的一版，便于对比。
 */

export async function findReview(
  userId: string,
  type: string,
  startDate: string,
  promptVersion: string,
): Promise<Review | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.type, type), eq(reviews.startDate, startDate), eq(reviews.promptVersion, promptVersion)))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertPending(input: {
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  promptVersion: string;
  model: string;
}): Promise<Review> {
  const db = await getDb();
  const existing = await findReview(input.userId, input.type, input.startDate, input.promptVersion);
  if (existing) {
    const rows = await db
      .update(reviews)
      .set({ status: "pending", model: input.model, updatedAt: new Date() })
      .where(eq(reviews.id, existing.id))
      .returning();
    return rows[0]!;
  }

  const [row] = await db
    .insert(reviews)
    .values({
      id: uuidv7(),
      userId: input.userId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      promptVersion: input.promptVersion,
      model: input.model,
      status: "pending",
      contentJson: {},
    })
    .onConflictDoNothing()
    .returning();

  if (row) return row;
  return (await findReview(input.userId, input.type, input.startDate, input.promptVersion))!;
}

export async function completeReview(id: string, content: unknown, providerId: string | null, model: string): Promise<void> {
  const db = await getDb();
  await db
    .update(reviews)
    .set({
      contentJson: content as object,
      status: "completed",
      providerId,
      model,
      generatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reviews.id, id));
}

export async function failReview(id: string, reason: string): Promise<void> {
  const db = await getDb();
  await db.update(reviews).set({ status: "failed", updatedAt: new Date(), contentJson: { error: reason } }).where(eq(reviews.id, id));
}

export async function listReviews(userId: string, type?: string, limit = 30): Promise<Review[]> {
  const db = await getDb();
  if (type) {
    return db
      .select()
      .from(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.type, type)))
      .orderBy(desc(reviews.startDate))
      .limit(limit);
  }
  return db.select().from(reviews).where(eq(reviews.userId, userId)).orderBy(desc(reviews.startDate)).limit(limit);
}

export async function findReviewById(userId: string, id: string): Promise<Review | null> {
  const db = await getDb();
  const rows = await db.select().from(reviews).where(and(eq(reviews.id, id), eq(reviews.userId, userId))).limit(1);
  return rows[0] ?? null;
}

/**
 * 删除复盘。复盘是派生内容（原文不受影响），不做软删，直接物理删除；
 * 想再看随时可以重新生成一条。
 * 返回 false 表示这条复盘不存在或不属于当前用户。
 */
export async function deleteReview(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .delete(reviews)
    .where(and(eq(reviews.id, id), eq(reviews.userId, userId)))
    .returning({ id: reviews.id });
  return rows.length > 0;
}

/**
 * 撤掉尚未跑的复盘任务。否则「删除 → 后台任务随后把同一条复盘又写回来」，
 * 用户会看到删不掉。只动 queued：正在跑的任务无法安全中断，让它写完再删即可。
 */
export async function cancelPendingReviewJobs(userId: string, type: string, startDate: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .delete(jobs)
    .where(
      and(
        eq(jobs.type, "review_generate"),
        eq(jobs.status, "queued"),
        like(jobs.idempotencyKey, `review:${userId}:${type}:${startDate}:%`),
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}
