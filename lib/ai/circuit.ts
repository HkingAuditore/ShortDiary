import { aiLogger } from "@/lib/obs/logger";

/**
 * 熔断器：同一 Provider 连续失败达阈值即熔断，非 AI 功能不受影响。
 * 进程内实现（单实例足够）；多实例时可移到 Postgres。
 */

interface BreakerState {
  failures: number;
  openUntil: number;
}

const THRESHOLD = 5;
const OPEN_MS = 5 * 60 * 1000;

const states = new Map<string, BreakerState>();

export function isOpen(providerId: string): boolean {
  const s = states.get(providerId);
  if (!s) return false;
  if (s.openUntil > Date.now()) return true;
  if (s.openUntil !== 0) states.delete(providerId);
  return false;
}

export function recordSuccess(providerId: string): void {
  states.delete(providerId);
}

export function recordFailure(providerId: string): void {
  const s = states.get(providerId) ?? { failures: 0, openUntil: 0 };
  s.failures += 1;
  if (s.failures >= THRESHOLD) {
    s.openUntil = Date.now() + OPEN_MS;
    aiLogger.warn({ providerId, failures: s.failures }, "Provider 已熔断");
  }
  states.set(providerId, s);
}

export function breakerSnapshot(): Array<{ providerId: string; failures: number; openUntil: number }> {
  return Array.from(states, ([providerId, s]) => ({ providerId, ...s }));
}

/** 单用户全局 AI 并发 ≤ 2 */
const MAX_CONCURRENT = 2;
let active = 0;

export async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (active < MAX_CONCURRENT) {
          clearInterval(timer);
          resolve();
        }
      }, 80);
    });
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
  }
}
