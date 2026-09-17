/**
 * 错误码单一来源。新增错误码必须同时补充 httpStatus 与用户可读文案，
 * 前端错误映射层按 code 取文案，服务端不向客户端暴露堆栈。
 */

export const ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  PROVIDER_AUTH_FAILED: "PROVIDER_AUTH_FAILED",
  PROVIDER_MODEL_MISSING: "PROVIDER_MODEL_MISSING",
  PROVIDER_INCOMPATIBLE: "PROVIDER_INCOMPATIBLE",
  PROVIDER_CIRCUIT_OPEN: "PROVIDER_CIRCUIT_OPEN",
  AI_TIMEOUT: "AI_TIMEOUT",
  AI_OUTPUT_INVALID: "AI_OUTPUT_INVALID",
  STORAGE_FAILED: "STORAGE_FAILED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  PROVIDER_AUTH_FAILED: 502,
  PROVIDER_MODEL_MISSING: 502,
  PROVIDER_INCOMPATIBLE: 502,
  PROVIDER_CIRCUIT_OPEN: 502,
  AI_TIMEOUT: 504,
  AI_OUTPUT_INVALID: 502,
  STORAGE_FAILED: 502,
  INTERNAL: 500,
};

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_INPUT: "输入内容有误，请检查后重试",
  UNAUTHENTICATED: "登录状态已失效，请重新登录",
  FORBIDDEN: "你没有权限执行该操作",
  NOT_FOUND: "没有找到对应内容",
  CONFLICT: "该内容已存在",
  RATE_LIMITED: "操作过于频繁，请稍后再试",
  PAYLOAD_TOO_LARGE: "内容过大，请精简后重试",
  PROVIDER_AUTH_FAILED: "API Key 无效，请检查 Provider 配置",
  PROVIDER_MODEL_MISSING: "该 Provider 下不存在这个模型",
  PROVIDER_INCOMPATIBLE: "Endpoint 不兼容，请检查协议与地址",
  PROVIDER_CIRCUIT_OPEN: "AI 服务暂时不可用，记录与归档功能不受影响",
  AI_TIMEOUT: "AI 响应超时，可重试一次",
  AI_OUTPUT_INVALID: "AI 返回内容无法解析，已保留原始记录",
  STORAGE_FAILED: "文件存储不可用，请稍后重试",
  INTERNAL: "服务出现异常，请稍后重试",
};

/** 4xx 不重试；5xx 由客户端最多重试 3 次 */
export function isRetryable(code: ErrorCode): boolean {
  return ERROR_HTTP_STATUS[code] >= 500;
}
