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

/**
 * 已经跑完的状态：命中这些状态的任务不算「同一件事还在做」，应当被复活重跑。
 * 否则「再试一次」这类入口永远空转 —— 同一条记录内容不变时幂等键不变，
 * 而上次的 job 行还留在表里（幂等键唯一），enqueue 会一路 dedupe 掉新请求，
 * 界面却已经把 ai_status 改成 queued，变成永远转圈的僵尸。
 */
const TERMINAL_JOB_STATUSES = ["succeeded", "failed", "dead"] as const;

export async function enqueue(input: EnqueueInput): Promise<{ id: string; deduped: boolean }> {
  const db = await getDb();
  const existing = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.idempotencyKey, input.idempotencyKey))
    .limit(1);

  const hit = existing[0];
  if (hit) {
    // 还在队列里（queued / running）：确实已经排上了，什么都不用做
    if (!(TERMINAL_JOB_STATUSES as readonly string[]).includes(hit.status)) {
      return { id: hit.id, deduped: true };
    }

    // 终态：原样复活这一行，重置尝试次数与失败信息
    const [revived] = await db
      .update(jobs)
      .set({
        status: "queued",
        payload: input.payload,
        attempts: 0,
        runAfter: input.runAfter ?? new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, hit.id), inArray(jobs.status, [...TERMINAL_JOB_STATUSES])))
      .returning({ id: jobs.id });

    // 复活成功即算新入队；若并发下被别人抢先开跑，就当作已入队
    if (revived) return { id: revived.id, deduped: false };
    return { id: hit.id, deduped: true };
  }

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

/**
 * 心跳：任务执行期间定期把 updated_at 推到现在。
 *
 * requeueStuckJobs 是靠「running 且 updated_at 太旧」来判断执行进程已死的，
 * 没有心跳时它会误伤真正在跑的长任务 —— 复盘一次要 3–9 分钟，而回收阈值只有 2 分钟，
 * 于是长任务每两分钟就被"回收"一次并被另一个 tick 重新领走（同一份复盘被反复调用 AI）。
 */
export async function touchJob(id: string): Promise<void> {
  const db = await getDb();
  await db.update(jobs).set({ updatedAt: new Date() }).where(eq(jobs.id, id));
}

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

/** 某一类任务还有多少在排队（用于观测「长任务饿着没跑」这类情况） */
export async function queuedDepth(types: JobType[]): Promise<number> {
  if (types.length === 0) return 0;
  const db = await getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), inArray(jobs.type, types)));
  return rows[0]?.n ?? 0;
}
