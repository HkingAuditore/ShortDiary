import type { AdapterContext, AiAdapter, AiRequest, AiResult } from "../types";
import { isTimeout, mapHttpError, splitMessages, withTimeout } from "./shared";
import { AppError } from "@/lib/errors/app-error";

/**
 * Anthropic Messages API 适配器。
 * system 独立字段；不支持 response_format，JSON 走「JSON-only 提示 + 抽取」。
 */

export const anthropicAdapter: AiAdapter = {
  protocol: "anthropic",

  async chat(req: AiRequest, ctx: AdapterContext): Promise<AiResult> {
    const started = Date.now();
    const { system, rest } = splitMessages(req);

    const messages = rest
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

    if (req.jsonMode) {
      const last = messages[messages.length - 1];
      if (last) last.content = `${last.content}\n\n请只输出一个 JSON 对象，不要包含任何解释或代码围栏。`;
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? 0.4,
      stream: Boolean(req.onDelta),
    };
    if (system) body.system = system;

    const { signal, done } = withTimeout(req.timeoutMs ?? 60_000, req.signal);
    try {
      const res = await fetch(`${ctx.baseUrl.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ctx.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw mapHttpError(res.status, text);
      }

      if (req.onDelta && res.body) {
        const text = await readAnthropicSse(res, req.onDelta);
        return { text, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - started, model: req.model };
      }

      const json = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      return {
        text: (json.content ?? []).map((c) => c.text ?? "").join(""),
        promptTokens: json.usage?.input_tokens ?? 0,
        completionTokens: json.usage?.output_tokens ?? 0,
        latencyMs: Date.now() - started,
        model: req.model,
      };
    } catch (err) {
      if (isTimeout(err)) throw new AppError("AI_TIMEOUT");
      throw err;
    } finally {
      done();
    }
  },
};

async function readAnthropicSse(res: Response, onDelta: (d: string) => void): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        const parsed = JSON.parse(trimmed.slice(5).trim()) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && parsed.delta.text) {
          full += parsed.delta.text;
          onDelta(parsed.delta.text);
        }
      } catch {
        // 忽略心跳
      }
    }
  }
  return full;
}
