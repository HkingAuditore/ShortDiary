import { claimNext, markFailed, markSucceeded, requeueStuckJobs, type JobType } from "./queue";
import { runAnnotateJob } from "./workers/annotate";
import { runReviewJob } from "./workers/review";
import { runGcJob } from "./workers/gc";
import type { Job } from "@/lib/db/schema";
import { jobLogger } from "@/lib/obs/logger";
import { ensureSchema } from "@/lib/db/migrate";

/**
 * 任务执行器，两种运行模式（JOB_WORKER_MODE）：
 * - inprocess（默认）：进程内 setInterval 轮询（tick），适合自托管 / 本地开发
 * - external：无进程内轮询，由外部调度打 POST /api/jobs/tick → runExternalTick，
 *   适合 EdgeOne Pages 等实例会冻结的无服务器平台
 * 两种模式的并发安全都由 FOR UPDATE SKIP LOCKED 保证，可并存（kickWorker 在
 * external 模式下仍会触发进程内 drain，实例温热时能立即处理，冻结则由外部调度兜底）。
 */

const HANDLERS: Record<JobType, (job: Job) => Promise<void>> = {
  ai_annotate: runAnnotateJob,
  review_generate: runReviewJob,
  export: async () => undefined,
  asset_gc: runGcJob,
};

const TYPES = Object.keys(HANDLERS) as JobType[];
const POLL_MS = 2_000;

interface WorkerState {
  timer?: NodeJS.Timeout;
  running: boolean;
}

const globalWorker = globalThis as unknown as { __pjWorker?: WorkerState };
const state: WorkerState = (globalWorker.__pjWorker ??= { running: false });

async function tick(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    // 每次最多串行处理 3 个任务，避免 AI 并发打满
    for (let i = 0; i < 3; i += 1) {
      const job = await claimNext(TYPES);
      if (!job) break;
      try {
        await HANDLERS[job.type as JobType](job);
        await markSucceeded(job.id);
        jobLogger.info({ id: job.id, type: job.type }, "任务完成");
      } catch (err) {
        await markFailed(job.id, err, job.attempts, job.maxAttempts);
      }
    }
  } catch (err) {
    jobLogger.error({ err }, "任务轮询异常");
  } finally {
    state.running = false;
  }
}

export interface TickStats {
  /** 本次领取的任务数 */
  claimed: number;
  succeeded: number;
  failed: number;
  /** 回收的 running 卡死任务数 */
  requeued: number;
  budgetMs: number;
  elapsedMs: number;
}

/**
 * 时间预算驱动的批量 drain：在预算内持续领取并执行任务。
 * 供外部触发（POST /api/jobs/tick）使用——无服务器平台单次函数执行有墙钟上限
 * （EdgeOne 默认 30s），必须留出余量在超时前正常返回。
 */
async function drainJobs(budgetMs: number): Promise<{ claimed: number; succeeded: number; failed: number }> {
  const deadline = Date.now() + budgetMs;
  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  while (Date.now() < deadline) {
    const job = await claimNext(TYPES);
    if (!job) break;
    claimed += 1;
    try {
      await HANDLERS[job.type as JobType](job);
      await markSucceeded(job.id);
      succeeded += 1;
      jobLogger.info({ id: job.id, type: job.type }, "任务完成");
    } catch (err) {
      await markFailed(job.id, err, job.attempts, job.maxAttempts);
      failed += 1;
    }
  }

  return { claimed, succeeded, failed };
}

/**
 * 外部触发的一次完整 tick：先回收卡死任务，再按预算 drain 队列。
 *
 * 回收阈值刻意压到 2 分钟：无服务器平台上进程可能被平台中途冻结，
 * 任务会停在 running 状态；annotate 等任务是幂等覆盖写，重复执行无害，
 * 宁可快速重跑也不要让一条任务卡到下一次人工干预。
 */
export async function runExternalTick(opts: { budgetMs?: number } = {}): Promise<TickStats> {
  const budgetMs = opts.budgetMs ?? 20_000;
  const startedAt = Date.now();

  let requeued = 0;
  try {
    requeued = await requeueStuckJobs(2);
  } catch (err) {
    jobLogger.error({ err }, "卡死任务回收失败");
  }

  const { claimed, succeeded, failed } = await drainJobs(budgetMs);
  return { claimed, succeeded, failed, requeued, budgetMs, elapsedMs: Date.now() - startedAt };
}

export function startWorker(): void {
  if (state.timer) return;

  void (async () => {
    try {
      await ensureSchema();
      await requeueStuckJobs();
    } catch (err) {
      jobLogger.error({ err }, "任务队列初始化失败");
    }
  })();

  state.timer = setInterval(() => void tick(), POLL_MS);
  // 定时器不应阻止进程退出
  if (typeof state.timer.unref === "function") state.timer.unref();
  jobLogger.info({ pollMs: POLL_MS }, "任务轮询已启动");
}

export function stopWorker(): void {
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = undefined;
}

/** 手动触发一次轮询（API 可用于「立即处理」） */
export async function drainOnce(): Promise<void> {
  await tick();
}

/**
 * 入队后立即触发一轮处理（fire-and-forget）。
 * 消除「入队后干等下一个轮询周期」的固有延迟；tick 内部有 running 保护，并发调用安全。
 */
export function kickWorker(): void {
  void tick();
}
