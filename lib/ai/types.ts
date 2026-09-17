import type { ProviderOverrides } from "@/lib/db/schema";

export type Protocol = "openai_compatible" | "anthropic" | "gemini";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiRequest {
  model: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 期望 JSON 输出；Provider 不支持时由 Adapter 降级为「JSON-only 提示 + 正则抽取」 */
  jsonMode?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

export interface AiResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  model: string;
}

export interface AdapterContext {
  baseUrl: string;
  apiKey: string;
  overrides?: ProviderOverrides;
}

export interface AiAdapter {
  protocol: Protocol;
  chat(req: AiRequest, ctx: AdapterContext): Promise<AiResult>;
}

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  openai_compatible: "OpenAI 兼容",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

export const PROTOCOL_DEFAULT_BASE_URL: Record<Protocol, string> = {
  openai_compatible: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};
