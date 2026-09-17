import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * 本地磁盘存储驱动。
 * 仅用于「未配置 COS」的开发与单机自托管场景；接口与 COS 驱动一致，
 * 业务层不感知差异，生产配置 COS_* 后自动切换。
 */

const ROOT = resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? ".data/uploads");

function safePath(key: string): string {
  const normalized = normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = join(ROOT, normalized);
  if (!full.startsWith(ROOT + sep) && full !== ROOT) {
    throw new Error("非法的存储 key");
  }
  return full;
}

export function localRoot(): string {
  return ROOT;
}

export function localAbsolutePath(key: string): string {
  return safePath(key);
}

export async function localPut(key: string, bytes: Buffer | Uint8Array): Promise<void> {
  const full = safePath(key);
  mkdirSync(dirname(full), { recursive: true });
  const stream = Readable.from(bytes instanceof Buffer ? [bytes] : [Buffer.from(bytes)]);
  await pipeline(stream, createWriteStream(full));
}

export function localExists(key: string): boolean {
  return existsSync(safePath(key));
}

export function localReadStream(key: string) {
  return createReadStream(safePath(key));
}

export async function localDelete(key: string): Promise<void> {
  const full = safePath(key);
  await rm(full, { force: true });
}

export function localByteSize(key: string): number | null {
  try {
    return statSync(safePath(key)).size;
  } catch {
    return null;
  }
}
