import { AppError } from "@/lib/errors/app-error";
import type { AiRequest } from "../types";

/**
 * 三类协议共用的工具：错误映射、超时控制、JSON 抽取。
 * 错误消息保留厂商原始 code 与 status，再映射为可理解的中文提示。
 */

export function mapHttpError(status: number, body: string): AppError {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) {
    return new AppError("PROVIDER_AUTH_FAILED", undefined, { status, vendor: extractVendorError(body) });
  }
  if (status === 404) {
    if (lower.includes("model")) {
      return new AppError("PROVIDER_MODEL_MISSING", undefined, { status, vendor: extractVendorError(body) });
    }
    return new AppError("PROVIDER_INCOMPATIBLE", undefined, { status, vendor: extractVendorError(body) });
  }
  if (status === 429) {
    return new AppError("RATE_LIMITED", "Provider 侧限流，请稍后重试", { status });
  }
  if (status >= 500) {
    return new AppError("PROVIDER_INCOMPATIBLE", "Provider 服务异常", { status });
  }
  return new AppError("PROVIDER_INCOMPATIBLE", undefined, { status, vendor: extractVendorError(body) });
}

function extractVendorError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string }; message?: string };
    return (parsed.error?.message ?? parsed.error?.code ?? parsed.message ?? body).slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

export function withTimeout(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onAbort = () => controller.abort(new Error("aborted"));
  if (external) {
    if (external.aborted) onAbort();
    else external.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      if (external) external.removeEventListener("abort", onAbort);
    },
  };
}

export function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.message === "timeout" || err.message === "aborted");
}

/**
 * 不支持 JSON mode 的 Provider 仍要产出结构化结果：
 * 先按 ```json 围栏抽取，再退回首个花括号包裹的片段。
 */
export function extractJson(text: string): unknown | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    try {
      return JSON.parse(candidate.slice(start, candidate.indexOf("\n", start) === -1 ? end + 1 : end + 1));
    } catch {
      return null;
    }
  }
}

export function splitMessages(req: AiRequest): { system: string | null; rest: AiRequest["messages"] } {
  const systemParts = req.messages.filter((m) => m.role === "system").map((m) => m.content);
  const rest = req.messages.filter((m) => m.role !== "system");
  return { system: systemParts.length ? systemParts.join("\n\n") : null, rest };
}
