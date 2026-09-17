import { randomUUID } from "node:crypto";

/**
 * COS Key 约定。
 * - 正式对象：u/<userId>/<yyyy>/<mm>/<uuid>.<ext>
 * - 临时对象：tmp/<userId>/<yyyy-mm-dd>/<uuid>.<ext>（24h 未引用即被 GC 清理）
 * key 内含 uuid，路径不可预测；Bucket 保持私有，读取一律走短期签名。
 */

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/heic": "heic",
};

export function extensionForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

export function buildObjectKey(userId: string, entryDate: string, mime: string): string {
  const [y, m] = entryDate.split("-");
  return `u/${userId}/${y}/${m}/${randomUUID()}.${extensionForMime(mime)}`;
}

export function buildTempKey(userId: string, mime: string, date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return `tmp/${userId}/${d}/${randomUUID()}.${extensionForMime(mime)}`;
}

export function isTempKey(key: string): boolean {
  return key.startsWith("tmp/");
}

export const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
]);

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
