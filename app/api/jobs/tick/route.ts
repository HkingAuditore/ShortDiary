import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { defineRoute } from "@/lib/api/route";
import { getEnv } from "@/lib/env";
import { runExternalTick, type TickMode } from "@/lib/jobs/runner";
import { AppError } from "@/lib/errors/app-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 外部任务触发端点（JOB_WORKER_MODE=external 时的任务入口）。
 * 由外部 cron（GitHub Actions / cron-job.org / 本机 crontab）或 EdgeOne
 * edgeone.json 的 schedules 定时调用。
 *
 * 鉴权（三选一，常量时间比较）：
 * - Header: Authorization: Bearer <JOB_TICK_SECRET>
 * - JSON body: {"secret": "<JOB_TICK_SECRET>"}（EdgeOne schedules 的 payload 只能放 body）
 * - Query: ?secret=<JOB_TICK_SECRET>（仅供只支持 GET 的极简 cron 服务，会进访问日志，不推荐）
 *
 * 可用参数（query 或 body）：
 * - mode=short|review|auto（默认 auto）。默认预算下 auto 只会跑到短任务，
 *   复盘要「剩余预算 ≥ 2 分钟」才会被领走；想跑复盘必须显式加大 budget。
 * - budget=<ms>，默认 25_000。上限 600_000，但不要超过触发器所在平台的墙钟
 *   （EdgeOne Pages Node 函数 30s；SCF 可在控制台单独调大）。
 *
 * 建议的两个触发器：
 * - 每分钟：{"secret":"...","mode":"short"}（或什么都不传）
 * - 每天一次：{"secret":"...","mode":"review","budget":600000}（SCF 超时配 ≥ 10 分钟）
 *
 * 未配置 JOB_TICK_SECRET 时端点一律 403，防止匿名触发烧 AI 调用费。
 */

const MIN_BUDGET_MS = 1_000;
const MAX_BUDGET_MS = 600_000;
const DEFAULT_BUDGET_MS = 25_000;
const MODES: TickMode[] = ["auto", "short", "review"];

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

async function handleTick(req: NextRequest) {
  const env = getEnv();
  if (!env.JOB_TICK_SECRET) {
    throw new AppError("FORBIDDEN", "任务触发端点未启用（未配置 JOB_TICK_SECRET）");
  }

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  let bodySecret = "";
  let bodyMode = "";
  let bodyBudget = Number.NaN;
  try {
    const body = (await req.json()) as { secret?: unknown; mode?: unknown; budget?: unknown } | null;
    if (typeof body?.secret === "string") bodySecret = body.secret;
    if (typeof body?.mode === "string") bodyMode = body.mode;
    if (body?.budget !== undefined) bodyBudget = Number(body.budget);
  } catch {
    // 空 body / 非 JSON body：允许，靠 header 或 query 鉴权
  }

  const url = new URL(req.url);
  const querySecret = url.searchParams.get("secret") ?? "";

  const provided = [bearer, bodySecret, querySecret].find((s) => s.length > 0) ?? "";
  if (!provided || !safeEq(provided, env.JOB_TICK_SECRET)) {
    throw new AppError("FORBIDDEN", "任务触发凭证无效");
  }

  const modeRaw = (url.searchParams.get("mode") ?? bodyMode).trim().toLowerCase();
  const mode: TickMode = (MODES as string[]).includes(modeRaw) ? (modeRaw as TickMode) : "auto";

  const budgetRaw = Number(url.searchParams.get("budget") ?? bodyBudget);
  const budgetMs = Number.isFinite(budgetRaw) && budgetRaw > 0
    ? Math.min(Math.max(budgetRaw, MIN_BUDGET_MS), MAX_BUDGET_MS)
    : DEFAULT_BUDGET_MS;

  const stats = await runExternalTick({ budgetMs, mode });
  return { data: stats };
}

export const POST = defineRoute(handleTick);

// 部分 cron 服务只支持 GET；secret 只能走 query（有日志泄露面，优先用 POST）
export const GET = defineRoute(handleTick);
