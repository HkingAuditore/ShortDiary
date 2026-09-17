import { ERROR_HTTP_STATUS, ERROR_MESSAGES, type ErrorCode } from "./codes";

/**
 * 类型化错误。业务层只抛 AppError，全局 handler 负责翻译成统一信封。
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown, cause?: unknown) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.details = details;
    if (cause !== undefined) this.cause = cause;
  }

  static invalidInput(message?: string, details?: unknown) {
    return new AppError("INVALID_INPUT", message, details);
  }
  static notFound(message?: string) {
    return new AppError("NOT_FOUND", message);
  }
  static conflict(message?: string) {
    return new AppError("CONFLICT", message);
  }
  static unauthenticated(message?: string) {
    return new AppError("UNAUTHENTICATED", message);
  }
  static forbidden(message?: string) {
    return new AppError("FORBIDDEN", message);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** 把任意异常收敛成 AppError，避免内部细节外泄 */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  return new AppError("INTERNAL", undefined, undefined, e);
}
