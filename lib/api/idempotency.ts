import { sql as raw } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

/**
 * 写接口幂等：客户端带 Idempotency-Key 头重复提交时，直接回放首次结果。
 * 覆盖场景：网络重试、双击发送、断网重发。
 */

const TTL_HOURS = 24;

interface Row {
  key: string;
  response_json: unknown;
}

async function read(key: string): Promise<unknown | null> {
  const db = await getDb();
  const result = await db.execute(
    raw`SELECT response_json FROM idempotency_records WHERE key = ${key} AND created_at > now() - ${`${TTL_HOURS} hours`}::interval LIMIT 1`,
  );
  const rows = Array.isArray(result) ? result : ((result as { rows?: Row[] }).rows ?? []);
  const first = (rows[0] as Row | undefined) ?? null;
  return first ? first.response_json : null;
}

async function write(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.execute(
    raw`INSERT INTO idempotency_records (key, response_json)
        VALUES (${key}, ${JSON.stringify(value)}::jsonb)
        ON CONFLICT (key) DO NOTHING`,
  );
}

export async function withIdempotency<T>(key: string | null, fn: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
  if (!key) return { result: await fn(), replayed: false };
  const existing = await read(key);
  if (existing !== null) return { result: existing as T, replayed: true };
  const result = await fn();
  await write(key, result).catch(() => undefined);
  return { result, replayed: false };
}

/** 清理过期记录（供 GC 调用） */
export async function purgeExpired(): Promise<void> {
  const db = await getDb();
  await db.execute(raw`DELETE FROM idempotency_records WHERE created_at < now() - ${`${TTL_HOURS} hours`}::interval`);
}
