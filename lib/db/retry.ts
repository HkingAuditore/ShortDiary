import { dbLogger } from "@/lib/obs/logger";
import { resetDatabase } from "./client";

/**
 * 无服务器平台（EdgeOne Pages / Vercel）上的数据库连接是「会断的」：
 * - 实例冻结后，连接池里的 TCP 连接早已被对端丢弃，但驱动不知情，
 *   直到下一次查询才炸（ECONNRESET / connection terminated）；
 * - 远端 Postgres（Neon 免费档）闲置挂起后，首次连接要等计算节点唤醒，可能超时。
 *
 * 这两类故障的共同点是「重试一次就好」，但前提是**必须重建连接池**——
 * 复用坏实例只会再炸一次。所以重试前一律 resetDatabase()。
 *
 * 只重试幂等路径：写操作重试可能造成重复执行（插入成功但连接先断），
 * 因此 defineRoute 只对 GET/HEAD 生效。
 */

/** Node / undici 网络层 + postgres.js 驱动层的瞬时错误码 */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  // postgres.js
  "CONNECTION_DESTROYED",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_CONNECT_TIMEOUT",
  "CONNECTION_TIMED_OUT",
]);

/**
 * SQLSTATE 前缀：
 * 08 = connection exception；53 = insufficient resources（53300 连接数打满）；
 * 57 = operator intervention（57P01 管理员关闭 / 57P03 正在启动不接受连接）。
 */
const TRANSIENT_SQLSTATE = /^(08|53|57)/;

const TRANSIENT_MESSAGE =
  /(connection|socket|terminated|unexpectedly|has been closed|econnreset|epipe|etimedout|timed? ?out|timeout|too many connections|fetch failed|premature close|other side closed|client has encountered a connection error)/i;

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  const raw = (err as { message?: unknown } | null)?.message;
  return typeof raw === "string" ? raw : String(err);
}

/** 判断是否为「重试一次大概率就好」的连接类故障 */
export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") {
    if (TRANSIENT_CODES.has(code)) return true;
    if (TRANSIENT_SQLSTATE.test(code)) return true;
  }

  return TRANSIENT_MESSAGE.test(messageOf(err));
}

export interface DbRetryOptions {
  /** 额外重试次数（总尝试次数 = retries + 1），默认 1 */
  retries?: number;
  /** 首次退避毫秒，之后按 2 倍递增，默认 150 */
  baseDelayMs?: number;
  /** 日志标记，便于定位是哪个调用点在重试 */
  scope?: string;
  /** 自定义可重试判定；不传则用 isTransientDbError */
  retryable?: (err: unknown) => boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 数据库读路径的重试包装。
 * 重试前会重建连接池；非连接类错误（SQL 语法、约束冲突等）直接抛出，不浪费时间。
 */
export async function withDbRetry<T>(fn: () => Promise<T>, options: DbRetryOptions = {}): Promise<T> {
  const { retries = 1, baseDelayMs = 150, scope = "db", retryable } = options;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const canRetry = retryable ? retryable(err) : isTransientDbError(err);
      if (attempt >= retries || !canRetry) throw err;

      attempt += 1;
      dbLogger.warn({ scope, attempt, err: messageOf(err) }, "数据库连接异常，重建连接池后重试");
      resetDatabase();
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
