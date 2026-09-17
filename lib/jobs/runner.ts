import { claimNext, markFailed, markSucceeded, requeueStuckJobs, type JobType } from "./queue";
import { runAnnotateJob } from "./workers/annotate";
import { runReviewJob } from "./workers/review";
import { runGcJob } from "./workers/gc";
import type { Job } from "@/lib/db/schema";
import { jobLogger } from "@/lib/obs/logger";
import { ensureSchema } from "@/lib/db/migrate";

/**
 * 进程内任务轮询器。单人部署下日任务量很小，5 秒轮询足够；
 * 每次取任务用 advisory lock + FOR UPDATE SKIP LOCKED 保证不重复执行。
 */

const HANDLERS: Record<JobType, (job: Job) => Promise<void>> = {
  ai_annotate: runAnnotateJob,
  review_generate: runReviewJob,
  export: async () => undefined,
  asset_gc: runGcJob,
};

const TYPES = Object.keys(HANDLERS) as JobType[];
const POLL_MS = 5_000;

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
