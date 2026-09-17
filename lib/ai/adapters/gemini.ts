import type { AdapterContext, AiAdapter, AiRequest, AiResult } from "../types";
import { isTimeout, mapHttpError, splitMessages, withTimeout } from "./shared";
import { AppError } from "@/lib/errors/app-error";

/**
 * Gemini generateContent 适配器。
 * 关键差异：system 走 systemInstruction；role 只有 user/model；鉴权用 ?key=。
 * 流式走 streamGenerateContent?alt=sse，不支持时回退一次性返回。
 */

export const geminiAdapter: AiAdapter = {
  protocol: "gemini",

  async chat(req: AiRequest, ctx: AdapterContext): Promise<AiResult> {
    const started = Date.now();
    const { system, rest } = splitMessages(req);

    const contents = rest.map((m) => ({
      role: m.role === "assistant" || m.role === "system" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    if (req.jsonMode) {
      const last = contents[contents.length - 1];
      if (last) last.parts[0]!.text = `${last.parts[0]!.text}\n\n请只输出一个 JSON 对象，不要包含任何解释或代码围栏。`;
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.4,
        ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
        ...(req.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const base = ctx.baseUrl.replace(/\/$/, "");
    const stream = Boolean(req.onDelta);
    const url = `${base}/models/${encodeURIComponent(req.model)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}?key=${encodeURIComponent(ctx.apiKey)}`;

    const { signal, done } = withTimeout(req.timeoutMs ?? 60_000, req.signal);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw mapHttpError(res.status, text);
      }

      if (stream && res.body) {
        const text = await readGeminiSse(res, req.onDelta ?? (() => undefined));
        return { text, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - started, model: req.model };
      }

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      return {
        text: (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
        promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
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

async function readGeminiSse(res: Response, onDelta: (d: string) => void): Promise<string> {
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
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const delta = (parsed.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // 忽略心跳
      }
    }
  }
  return full;
}
