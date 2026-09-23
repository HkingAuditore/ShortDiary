import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import type { Job } from "@/lib/db/schema";
import { uuidv7 } from "@/lib/utils/uuid";
import { jobLogger } from "@/lib/obs/logger";

/**
 * V1 任务队列：Postgres 表 + FOR UPDATE SKIP LOCKED 行级锁。
 * 单人部署下日任务量 < 200 条，不引入 Redis 这个额外的 stateful 组件；
 * 表结构按 BullMQ 语义设计（type/payload/idempotency_key/attempts/max_attempts/run_after），
 * 后续可平滑替换为 Redis 实现。
 */

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

  // 并发安全完全由 FOR UPDATE SKIP LOCKED 保证：两个 worker 同时领取时，
  // 后到的子查询会跳过已被锁定的行，绝不会重复执行同一任务。
  // （历史上这里还套过 session 级 pg_try_advisory_lock——在 postgres.js 连接池下
  // lock 与 unlock 可能落在不同连接上，锁会一直挂在旧连接直到其超时关闭，
  // 期间所有 claim 都拿不到锁；事务级行锁没有这个问题，故移除。）
  const result = await db.execute(sql`
    UPDATE jobs
    SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'queued' AND run_after <= now()
        AND attempts < max_attempts
        AND type IN (${sql.join(
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
  // 原生 SQL RETURNING * 返回 snake_case 列名，必须映射回 camelCase，
  // 否则 job.maxAttempts 为 undefined，markFailed 的 exhausted 判断永远为 false
  // （历史 bug：任务失败上百次也不标 dead，无限空转重试）
  const raw = rows[0] as Record<string, unknown> | undefined;
  if (!raw) return null;
  return {
    ...raw,
    maxAttempts: (raw.maxAttempts ?? raw.max_attempts) as number,
    idempotencyKey: (raw.idempotencyKey ?? raw.idempotency_key) as string,
    runAfter: (raw.runAfter ?? raw.run_after) as Date,
    createdAt: (raw.createdAt ?? raw.created_at) as Date,
    updatedAt: (raw.updatedAt ?? raw.updated_at) as Date,
    lastError: (raw.lastError ?? raw.last_error) as string | null,
  } as Job;
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

  jobLogger.warn({ id, attempts, maxAttempts, exhausted, error: message.slice(0, 200) }, "任务失败");
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
