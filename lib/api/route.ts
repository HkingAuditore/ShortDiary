import type { NextRequest } from "next/server";
import { runWithContext, newRequestId } from "@/lib/obs/request-id";
import { logger } from "@/lib/obs/logger";
import { toErrorResponse, toSuccessResponse } from "@/lib/errors/handler";
import { AppError } from "@/lib/errors/app-error";
import { checkRateLimit } from "./rate-limit";

/**
 * Route Handler 包装器：注入 requestId（AsyncLocalStorage 全链路透传）、
 * 记录访问日志、统一错误信封，并可选开启限流。
 */

export interface RouteOptions {
  /** 每分钟允许次数；不传则不限流 */
  rateLimit?: { limit: number; key?: string };
  /** 是否要求登录（默认不要求，由 handler 自行调用 requireUser） */
}

// 流式下载等场景需要直接返回原生 Response（NextResponse 只是它的子类），
// 这里必须用 Response 判定，否则会被当成 JSON 信封序列化成空 data。
type HandlerResult<T> = { data: T; meta?: Record<string, unknown>; status?: number } | Response;

export interface RouteCtx {
  /** Next 15 中 params 是 Promise，这里已预先 await */
  params: Record<string, string>;
}

/**
 * Next 15 生成的路由类型要求第二个入参为「非可选的 { params: Promise<...> }」，
 * 这里保持该形状；运行时仍做防御式取值（某些路由没有动态段）。
 */
export type RouteSegment = { params: Promise<Record<string, string>> };

export function defineRoute<T>(
  handler: (req: NextRequest, ctx: RouteCtx) => Promise<HandlerResult<T>>,
  options: RouteOptions = {},
) {
  return async function routeHandler(req: NextRequest, segment: RouteSegment): Promise<Response> {
    const requestId = req.headers.get("x-request-id") ?? newRequestId();
    const startedAt = Date.now();

    return runWithContext({ requestId, path: new URL(req.url).pathname }, async () => {
      try {
        if (options.rateLimit) {
          const identity = options.rateLimit.key ?? req.headers.get("x-forwarded-for") ?? "local";
          const allowed = checkRateLimit(`${options.rateLimit.key ?? new URL(req.url).pathname}:${identity}`, options.rateLimit.limit);
          if (!allowed) {
            throw new AppError("RATE_LIMITED");
          }
        }

        const rawParams = (segment as RouteSegment | undefined)?.params;
        const params = rawParams ? await rawParams : {};
        const result = await handler(req, { params });

        if (result instanceof Response) {
          logger.info({ ms: Date.now() - startedAt, status: result.status }, "请求完成");
          return result;
        }

        const res = toSuccessResponse(result.data, result.meta, result.status ?? 200);
        logger.info({ ms: Date.now() - startedAt, status: res.status }, "请求完成");
        return res;
      } catch (err) {
        return toErrorResponse(err, requestId);
      }
    });
  };
}

/** Server Action 场景：把异常收敛为可展示的结果 */
export async function safeAction<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string; message: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const appErr = err instanceof AppError ? err : new AppError("INTERNAL");
    logger.warn({ code: appErr.code, err }, "Server Action 失败");
    return { ok: false, code: appErr.code, message: appErr.message };
  }
}
