import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, toAppError } from "./app-error";
import { ERROR_CODES, type ErrorCode } from "./codes";
import { logger } from "@/lib/obs/logger";
import { getRequestId } from "@/lib/obs/request-id";

/**
 * 全局错误处理：统一信封，生产环境绝不返回堆栈或内部细节。
 */

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export interface SuccessBody<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export function toErrorResponse(err: unknown, requestId = getRequestId()): NextResponse<ErrorBody> {
  let appErr: AppError;

  // req.json() 遇到非 JSON / 畸形 body 抛 SyntaxError，属于客户端问题，必须给 400 而不是 500
  if (err instanceof SyntaxError) {
    appErr = new AppError(ERROR_CODES.INVALID_INPUT, "请求体不是合法的 JSON");
  } else if (err instanceof ZodError) {
    appErr = new AppError(
      ERROR_CODES.INVALID_INPUT,
      "输入内容有误，请检查后重试",
      err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  } else {
    appErr = toAppError(err);
  }

  if (appErr.httpStatus >= 500) {
    logger.error({ err, code: appErr.code, requestId }, "请求处理失败");
  } else {
    logger.warn({ code: appErr.code, requestId, details: appErr.details }, "请求被拒绝");
  }

  const body: ErrorBody = {
    error: {
      code: appErr.code,
      message: appErr.message,
      requestId,
      ...(appErr.details !== undefined ? { details: appErr.details } : {}),
    },
  };

  return NextResponse.json(body, {
    status: appErr.httpStatus,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function toSuccessResponse<T>(data: T, meta?: Record<string, unknown>, status = 200): NextResponse<SuccessBody<T>> {
  const requestId = getRequestId();
  return NextResponse.json(
    { data, ...(meta ? { meta: { ...meta, requestId } } : { meta: { requestId } }) },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
