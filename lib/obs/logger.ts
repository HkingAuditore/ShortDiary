import pino from "pino";
import { getContext } from "./request-id";

/**
 * 结构化 JSON 日志。
 * 硬性要求：禁止记录日记正文、签名 URL、API Key、完整 Prompt。
 * 因此这里除了 pino 的 redact，还提供 scrub() 主动裁剪长文本字段。
 */

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.apiKey",
  "*.api_key",
  "*.encryptedKey",
  "*.password",
  "*.passwordHash",
  "*.signature",
  "*.signedUrl",
  "*.content",
  "*.prompt",
  "*.messages",
];

const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level,
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  base: { service: "paper-journal" },
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin() {
    const ctx = getContext();
    if (!ctx) return {};
    return { requestId: ctx.requestId, userId: ctx.userId };
  },
});

/** 超过阈值的字符串一律裁剪，避免正文/长 prompt 落盘 */
export function scrub(value: unknown, max = 120): unknown {
  if (typeof value === "string") {
    return value.length > max ? `${value.slice(0, max)}…(${value.length})` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 10).map((v) => scrub(v, max));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (["content", "prompt", "messages", "apiKey", "encryptedKey"].includes(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = scrub(v, max);
      }
    }
    return out;
  }
  return value;
}

export const aiLogger = logger.child({ scope: "ai" });
export const dbLogger = logger.child({ scope: "db" });
export const storageLogger = logger.child({ scope: "storage" });
export const jobLogger = logger.child({ scope: "jobs" });
