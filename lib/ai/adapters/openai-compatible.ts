import type { AdapterContext, AiAdapter, AiRequest, AiResult } from "../types";
import { isTimeout, mapHttpError, splitMessages, withTimeout } from "./shared";
import { AppError } from "@/lib/errors/app-error";

/**
 * OpenAI-Compatible 适配器。
 * 注意：同协议不同厂商参数差异很大（JSON mode、system role、上下文上限），
 * 全部通过 overrides 能力开关处理。
 */

export const openaiCompatibleAdapter: AiAdapter = {
  protocol: "openai_compatible",

  async chat(req: AiRequest, ctx: AdapterContext): Promise<AiResult> {
    const started = Date.now();
    const { system, rest } = splitMessages(req);
    const supportsSystem = ctx.overrides?.supportsSystemRole !== false;
    const supportsJson = ctx.overrides?.supportsJsonMode !== false;

    const messages = supportsSystem
      ? [...(system ? [{ role: "system" as const, content: system }] : []), ...rest]
      : // 不支持 system role：拼进首条 user message
        rest.map((m, i) => (i === 0 && system ? { ...m, content: `${system}\n\n${m.content}` } : m));

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      temperature: req.temperature ?? 0.4,
      stream: Boolean(req.onDelta),
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.jsonMode && supportsJson) body.response_format = { type: "json_object" };
    if (req.jsonMode && !supportsJson) {
      // 降级：在最后一条 user 消息里明确要求只输出 JSON
      const last = messages[messages.length - 1];
      if (last && last.role === "user") last.content = `${last.content}\n\n请只输出一个 JSON 对象，不要包含任何解释或代码围栏。`;
    }

    const { signal, done } = withTimeout(req.timeoutMs ?? 60_000, req.signal);
    try {
      const res = await fetch(`${ctx.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ctx.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw mapHttpError(res.status, text);
      }

      if (req.onDelta && res.body) {
        const text = await readSse(res, req.onDelta);
        return {
          text,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: Date.now() - started,
          model: req.model,
        };
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        text: json.choices?.[0]?.message?.content ?? "",
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
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

async function readSse(res: Response, onDelta: (d: string) => void): Promise<string> {
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
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return full;
      try {
        const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = parsed.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // 忽略无法解析的心跳行
      }
    }
  }
  return full;
}
