import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 集中配置校验。设计要点：
 * - 惰性求值：构建期（next build）不强制要求密钥存在，首次真正使用时才 fail-fast。
 * - 校验失败直接抛错退出，不允许带着半套配置运行（对应实施计划 P0-2）。
 */

const base64Key = z
  .string()
  .min(1)
  .refine((v) => {
    try {
      return Buffer.from(v, "base64").length === 32;
    } catch {
      return false;
    }
  }, "APP_MASTER_KEY 必须是 32 字节的 base64 字符串（可用 `openssl rand -base64 32` 生成）");

/**
 * .env 里写成 `DATABASE_URL=` 时 process.env 拿到的是空字符串，
 * 而 optional() 不接受空串 —— 必须先归一化成 undefined，否则整份配置校验失败。
 */
const optionalString = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().url().optional(),
  ),
  APP_MASTER_KEY: base64Key,
  AUTH_SECRET: z.string().min(16),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  ),

  COS_SECRET_ID: optionalString,
  COS_SECRET_KEY: optionalString,
  COS_BUCKET: optionalString,
  COS_REGION: optionalString,
  COS_CDN_DOMAIN: optionalString,

  STORAGE_DRIVER: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(["cos", "local"]).optional(),
  ),

  /**
   * 任务 worker 运行模式：
   * - inprocess（默认）：进程内 setInterval 轮询，适合自托管 / 本地开发
   * - external：不起常驻轮询，由外部调度（cron / 平台定时触发器）打 POST /api/jobs/tick，
   *   适合 EdgeOne Pages 等实例会冻结的无服务器平台
   */
  JOB_WORKER_MODE: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(["inprocess", "external"]).default("inprocess"),
  ),

  /** external 模式下 tick 端点的触发凭证；不配置则端点拒绝所有请求 */
  JOB_TICK_SECRET: optionalString,
});

export type Env = z.infer<typeof schema> & { storageDriver: "cos" | "local" };

let cached: Env | null = null;

function loadDotEnvOnce() {
  // Next.js 自身会加载 .env；独立脚本（tsx）场景下手动兜底加载
  if (process.env.__PJ_DOTENV_LOADED__) return;
  process.env.__PJ_DOTENV_LOADED__ = "1";
  const file = resolve(process.cwd(), ".env");
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function resolveStorageDriver(raw: z.infer<typeof schema>): "cos" | "local" {
  if (raw.STORAGE_DRIVER) return raw.STORAGE_DRIVER;
  const cosConfigured = Boolean(raw.COS_SECRET_ID && raw.COS_SECRET_KEY && raw.COS_BUCKET && raw.COS_REGION);
  return cosConfigured ? "cos" : "local";
}

export function getEnv(): Env {
  if (cached) return cached;
  loadDotEnvOnce();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`环境变量校验失败，服务拒绝启动：\n${issues}\n请复制 .env.example 为 .env 并补齐（可用 npm run bootstrap 生成开发用密钥）。`);
  }
  cached = { ...parsed.data, storageDriver: resolveStorageDriver(parsed.data) };
  return cached;
}

/** 供测试使用：强制刷新缓存 */
export function resetEnvCache() {
  cached = null;
}

export function isCosConfigured(): boolean {
  return getEnv().storageDriver === "cos";
}
