import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestContext {
  requestId: string;
  userId?: string;
  path?: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: Partial<RequestContext>, fn: () => T): T {
  return storage.run(
    { requestId: ctx.requestId ?? randomUUID(), userId: ctx.userId, path: ctx.path, startedAt: ctx.startedAt ?? Date.now() },
    fn,
  );
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string {
  return storage.getStore()?.requestId ?? "unknown";
}

export function getUserId(): string | undefined {
  return storage.getStore()?.userId;
}

/** 传入外部请求头中的 request id（若可信），否则生成新的 */
export function newRequestId(): string {
  return randomUUID();
}
