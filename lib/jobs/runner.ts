import {
  claimNext,
  markFailed,
  markSucceeded,
  queuedDepth,
  requeueStuckJobs,
  touchJob,
  type JobType,
} from "./queue";
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
 *
 * 2026-09-24 事故（云端一直「AI 整理中」、整条队列停摆）之后补上的两条硬约束：
 * 1. 任务执行必须有硬超时。原先是裸 await handler，一条卡住的复盘能把整次 tick 拖死；
 *    函数被平台杀掉后任务永远停在 running，而 SCF 的定时触发器在上一次调用未结束时
 *    不再触发 —— 整条队列就此冻结，后面的附注干等 20 分钟。
 * 2. 长任务不得与短任务共用一条通道。复盘要跑几分钟，串行 drain 会让它占满整次 tick；
 *    现在短任务先跑，只有短任务清空后才动长任务。
 */

const HANDLERS: Record<JobType, (job: Job) => Promise<void>> = {
  ai_annotate: runAnnotateJob,
  review_generate: runReviewJob,
  export: async () => undefined,
  asset_gc: runGcJob,
};

/** 短任务：单次 AI 调用能在一分钟内收尾 */
const SHORT_TYPES: JobType[] = ["ai_annotate", "asset_gc", "export"];
/** 长任务：复盘实测 3–9 分钟，必须分通道 */
const REVIEW_TYPES: JobType[] = ["review_generate"];
const ALL_TYPES: JobType[] = [...SHORT_TYPES, ...REVIEW_TYPES];

const POLL_MS = 2_000;
/** 单任务硬上限：超过就让出，函数必须先于平台墙钟返回 */
const JOB_MAX_MS = 300_000;
/**
 * 领下一条短任务前至少要剩下的预算。
 * 注意别设太大：executeJob 已有到 deadline 的硬超时，这道门槛只是为了避免
 * "刚领到就被掐断"（省一次无谓的重试），不是安全边界本身。
 */
const MIN_JOB_MS = 5_000;
/**
 * 领一条复盘前必须至少有这么多的剩余预算。
 * 复盘实测 3–9 分钟，预算不够就干脆不领 —— 否则每次 tick 都跑到一半被掐断，
 * 白烧一次完整重试（attempts 用尽后任务直接 dead，用户永远看不到复盘）。
 */
const REVIEW_MIN_MS = 120_000;
/** 心跳间隔，远小于 requeueStuckJobs 的 2 分钟回收阈值 */
const HEARTBEAT_MS = 30_000;
/**
 * 外部触发的默认预算。EdgeOne Pages 的 Node 函数墙钟只有 30s，
 * 默认必须留足安全边界先返回；要跑复盘得由调用方显式传更大的 budget
 * （配合一个超时时间够长的触发器）。
 */
const DEFAULT_BUDGET_MS = 25_000;
/** 进程内轮询（本地 / 自托管）没有平台墙钟，给足时间 */
const INPROCESS_BUDGET_MS = 600_000;
const INPROCESS_MAX_JOBS = 3;

export type TickMode = "auto" | "short" | "review";

interface DrainResult {
  claimed: number;
  succeeded: number;
  failed: number;
}

const EMPTY_DRAIN: DrainResult = { claimed: 0, succeeded: 0, failed: 0 };

class JobBudgetExceeded extends Error {
  constructor(ms: number) {
    super(`任务超出本次调度预算（${Math.round(ms / 1000)}s），已让出等下一轮`);
    this.name = "JobBudgetExceeded";
  }
}

interface WorkerState {
  timer?: NodeJS.Timeout;
  running: boolean;
}

const globalWorker = globalThis as unknown as { __pjWorker?: WorkerState };
const state: WorkerState = (globalWorker.__pjWorker ??= { running: false });

/**
 * 执行单个任务，带两重保护：
 * - 心跳：每 30s 推一次 job.updated_at，免得 requeueStuckJobs 把正在跑的长任务当成
 *   死任务回收掉（回收后会被另一个 tick 重新领走，同一份复盘被反复调用 AI）。
 * - 预算：超过本次剩余预算就抛错让出，函数按时返回；任务由 markFailed 放回队列重试。
 */
async function executeJob(job: Job, budgetMs: number): Promise<void> {
  const heartbeat = setInterval(() => void touchJob(job.id).catch(() => undefined), HEARTBEAT_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      HANDLERS[job.type as JobType](job),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new JobBudgetExceeded(budgetMs)), budgetMs);
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
  } finally {
    clearInterval(heartbeat);
    if (timer) clearTimeout(timer);
  }
}

interface DrainOptions {
  /** 领新任务前至少要剩下的预算，默认 MIN_JOB_MS */
  minJobMs?: number;
  /** 本次最多领几条（进程内轮询用 3，避免 AI 并发打满） */
  maxJobs?: number;
}

/**
 * 在截止时间前持续领取并执行指定类型的任务。
 * 只有剩余预算 >= minJobMs 时才会去领下一条，避免"领了却跑不完"。
 */
async function drainJobs(
  deadline: number,
  types: JobType[],
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const maxJobs = opts.maxJobs ?? Infinity;
  const minJobMs = opts.minJobMs ?? MIN_JOB_MS;
  const result: DrainResult = { claimed: 0, succeeded: 0, failed: 0 };

  while (result.claimed < maxJobs && Date.now() + minJobMs < deadline) {
    const job = await claimNext(types);
    if (!job) break;
    result.claimed += 1;

    const budget = Math.min(deadline - Date.now(), JOB_MAX_MS);
    const startedAt = Date.now();
    try {
      await executeJob(job, budget);
      await markSucceeded(job.id);
      result.succeeded += 1;
      jobLogger.info({ id: job.id, type: job.type, ms: Date.now() - startedAt }, "任务完成");
    } catch (err) {
      await markFailed(job.id, err, job.attempts, job.maxAttempts);
      result.failed += 1;
    }
  }

  return result;
}

async function tick(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    await drainJobs(Date.now() + INPROCESS_BUDGET_MS, ALL_TYPES, { maxJobs: INPROCESS_MAX_JOBS });
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
  mode: TickMode;
  /** 分通道统计，一眼看出是不是长任务在拖后腿 */
  short: DrainResult;
  review: DrainResult;
  /** 队列里还剩多少复盘没跑（预算不够时会 > 0） */
  reviewWaiting: number;
}

/**
 * 外部触发的一次完整 tick：先回收卡死任务，再按预算 drain 队列。
 *
 * mode：
 * - auto（默认）：先跑短任务，短任务清空后再看复盘。复盘还要满足「剩余预算 ≥ 2 分钟」
 *   才领，所以默认 25s 的 tick 天然只跑短任务 —— 长任务不会挤占用户刚写完的记录。
 * - short：只跑短任务。
 * - review：只跑复盘（配大预算的专属触发器时用）。
 *
 * 回收阈值刻意压到 2 分钟：无服务器平台上进程可能被平台中途冻结，任务会停在
 * running；有心跳的长任务不会被这条规则误伤，annotate 等任务是幂等覆盖写，重复执行无害。
 */
export async function runExternalTick(
  opts: { budgetMs?: number; mode?: TickMode } = {},
): Promise<TickStats> {
  const mode: TickMode = opts.mode ?? "auto";
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;

  let requeued = 0;
  try {
    requeued = await requeueStuckJobs(2);
  } catch (err) {
    jobLogger.error({ err }, "卡死任务回收失败");
  }

  const short = mode === "review" ? EMPTY_DRAIN : await drainJobs(deadline, SHORT_TYPES);
  const review =
    mode === "short"
      ? EMPTY_DRAIN
      : await drainJobs(deadline, REVIEW_TYPES, { minJobMs: REVIEW_MIN_MS, maxJobs: 1 });

  let reviewWaiting = 0;
  try {
    reviewWaiting = await queuedDepth(REVIEW_TYPES);
  } catch {
    // 统计失败不影响本次执行结果
  }

  return {
    claimed: short.claimed + review.claimed,
    succeeded: short.succeeded + review.succeeded,
    failed: short.failed + review.failed,
    requeued,
    budgetMs,
    elapsedMs: Date.now() - startedAt,
    mode,
    short,
    review,
    reviewWaiting,
  };
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
