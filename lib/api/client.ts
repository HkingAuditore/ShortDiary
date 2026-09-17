import { ERROR_MESSAGES, isRetryable, type ErrorCode } from "@/lib/errors/codes";

/**
 * 前端 API 客户端：统一信封解析、错误映射、重试策略。
 * 4xx 不重试；5xx 最多重试 3 次；fetch 失败提示离线。
 */

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(code: ErrorCode, message: string, httpStatus: number, details?: unknown, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.requestId = requestId;
  }
}

interface Envelope<T> {
  data?: T;
  meta?: PageMeta;
  error?: { code: ErrorCode; message?: string; details?: unknown; requestId?: string };
}

export interface PageMeta {
  nextCursor?: string;
  hasMore?: boolean;
  total?: number;
  requestId?: string;
}

/** 带分页元信息的响应：游标分页必须拿到 meta，否则无法翻页 */
export interface Paged<T> {
  data: T;
  meta: PageMeta;
}

async function requestFull<T>(path: string, init: RequestInit, retries = 3): Promise<Paged<T>> {
  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(path, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      });

      const text = await res.text();
      const payload = text ? (JSON.parse(text) as Envelope<T>) : ({} as Envelope<T>);

      if (!res.ok || payload.error) {
        const err = payload.error;
        const code: ErrorCode = err?.code ?? "INTERNAL";
        const apiError = new ApiError(
          code,
          err?.message ?? ERROR_MESSAGES[code],
          res.status,
          err?.details,
          err?.requestId,
        );
        if (!isRetryable(code)) throw apiError;
        lastError = apiError;
      } else {
        return { data: payload.data as T, meta: payload.meta ?? {} };
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (!isRetryable(err.code)) throw err;
        lastError = err;
      } else if (err instanceof TypeError) {
        // 网络不可达
        throw new ApiError("INTERNAL", "网络似乎断开了，请检查连接", 0);
      } else {
        throw err;
      }
    }

    if (attempt < retries) await sleep(300 * 2 ** attempt);
  }

  throw lastError ?? new ApiError("INTERNAL", ERROR_MESSAGES.INTERNAL, 500);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toSearch(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return "";
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

async function request<T>(path: string, init: RequestInit, retries = 3): Promise<T> {
  return (await requestFull<T>(path, init, retries)).data;
}

export function apiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const search = toSearch(params);
  return request<T>(search ? `${path}?${search}` : path, { method: "GET" });
}

/** 游标分页专用：需要 meta.nextCursor / meta.hasMore */
export function apiGetPage<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<Paged<T>> {
  const search = toSearch(params);
  return requestFull<T>(search ? `${path}?${search}` : path, { method: "GET" });
}

export function apiSend<T>(path: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown, headers?: Record<string, string>): Promise<T> {
  return request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
}

/** 上传票据：结构与服务端的 UploadTicket 对齐，但不引入服务端依赖 */
export interface UploadTicketLike {
  driver: "cos" | "local";
  key: string;
  url: string;
  method: "PUT" | "POST";
  headers?: Record<string, string>;
  token?: string;
}

/** 直传：图片字节不经过应用服务器 */
export async function uploadWithTicket(ticket: UploadTicketLike, blob: Blob, mime: string): Promise<void> {
  const url =
    ticket.driver === "local"
      ? `${ticket.url}?key=${encodeURIComponent(ticket.key)}&token=${encodeURIComponent(ticket.token ?? "")}`
      : ticket.url;

  const res = await fetch(url, {
    method: ticket.method,
    headers: { "content-type": mime, ...(ticket.headers ?? {}) },
    body: blob,
    credentials: "same-origin",
  });

  if (!res.ok) throw new ApiError("STORAGE_FAILED", `上传失败（HTTP ${res.status}）`, res.status);
}
