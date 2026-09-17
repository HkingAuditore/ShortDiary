import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import type { Job } from "@/lib/db/schema";
import { uuidv7 } from "@/lib/utils/uuid";
import { jobLogger } from "@/lib/obs/logger";

/**
 * V1 任务队列：Postgres 表 + advisory lock。
 * 单人部署下日任务量 < 200 条，不引入 Redis 这个额外的 stateful 组件；
 * 表结构按 BullMQ 语义设计（type/payload/idempotency_key/attempts/max_attempts/run_after），
 * 后续可平滑替换为 Redis 实现。
 */

const ADVISORY_LOCK_KEY = 0x504a4a4f; // "PJJO"

export type JobType = "ai_annotate" | "review_generate" | "export" | "asset_gc";

export interface EnqueueInput {
  type: JobType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  runAfter?: Date;
  maxAttempts?: number;
}

export async function enqueue(input: EnqueueInput): Promise<{ id: string; deduped: boolean }> {
  const db = await getDb();
  const existing = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing[0]) return { id: existing[0].id, deduped: true };

  try {
    const [row] = await db
      .insert(jobs)
      .values({
        id: uuidv7(),
        type: input.type,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        status: "queued",
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 3,
        runAfter: input.runAfter ?? new Date(),
      })
      .returning({ id: jobs.id });
    return { id: row!.id, deduped: false };
  } catch (err) {
    // 并发下唯一键冲突：视为已入队
    const again = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.idempotencyKey, input.idempotencyKey)).limit(1);
    if (again[0]) return { id: again[0].id, deduped: true };
    throw err;
  }
}

export async function claimNext(types: JobType[]): Promise<Job | null> {
  const db = await getDb();
  const locked = await db.execute(sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS ok`);
  const ok = Array.isArray(locked) ? (locked[0] as { ok?: boolean })?.ok : (locked as { rows?: Array<{ ok?: boolean }> })?.rows?.[0]?.ok;
  if (!ok) return null;

  try {
    const result = await db.execute(sql`
      UPDATE jobs
      SET status = 'running', attempts = attempts + 1, updated_at = now()
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'queued' AND run_after <= now() AND type IN (${sql.join(
          types.map((t) => sql`${t}`),
          sql`, `,
        )})
        ORDER BY run_after ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    return (rows[0] as Job) ?? null;
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
  }
}

const BACKOFF_MS = [1_000, 4_000, 15_000];

export async function markSucceeded(id: string): Promise<void> {
  const db = await getDb();
  await db.update(jobs).set({ status: "succeeded", lastError: null, updatedAt: new Date() }).where(eq(jobs.id, id));
}

export async function markFailed(id: string, error: unknown, attempts: number, maxAttempts: number): Promise<void> {
  const db = await getDb();
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = attempts >= maxAttempts;
  const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 15_000;

  await db
    .update(jobs)
    .set({
      status: exhausted ? "dead" : "queued",
      lastError: message.slice(0, 500),
      runAfter: exhausted ? new Date() : new Date(Date.now() + delay),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, id));

  jobLogger.warn({ id, attempts, maxAttempts, exhausted }, "任务失败");
}

export async function pendingDepth(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "running"])));
  return rows[0]?.n ?? 0;
}

export async function findJob(id: string): Promise<Job | null> {
  const db = await getDb();
  const rows = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 重启时把「卡在 running」的任务重新放回队列 */
export async function requeueStuckJobs(olderThanMinutes = 10): Promise<number> {
  const db = await getDb();
  const rows = await db
    .update(jobs)
    .set({ status: "queued", updatedAt: new Date() })
    .where(
      and(
        eq(jobs.status, "running"),
        lte(jobs.updatedAt, sql`now() - ${`${olderThanMinutes} minutes`}::interval`),
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

export async function nextQueuedRunAt(): Promise<Date | null> {
  const db = await getDb();
  const rows = await db
    .select({ runAfter: jobs.runAfter })
    .from(jobs)
    .where(eq(jobs.status, "queued"))
    .orderBy(asc(jobs.runAfter))
    .limit(1);
  return rows[0]?.runAfter ?? null;
}
