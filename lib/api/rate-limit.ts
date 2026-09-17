/**
 * 进程内令牌桶。单人部署单实例足够；
 * 未来多实例时替换为 Postgres 计数表（接口不变）。
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export function checkRateLimit(key: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const refillPerMs = limitPerMinute / 60_000;

  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size > MAX_KEYS) {
      // 清理最久未更新的桶，避免内存无界增长
      for (const [k, v] of buckets) {
        if (now - v.updatedAt > 600_000) buckets.delete(k);
      }
    }
    bucket = { tokens: limitPerMinute, updatedAt: now };
    buckets.set(key, bucket);
  }

  const elapsed = now - bucket.updatedAt;
  bucket.tokens = Math.min(limitPerMinute, bucket.tokens + elapsed * refillPerMs);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function resetRateLimits() {
  buckets.clear();
}
