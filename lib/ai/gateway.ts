import type { ZodType } from "zod";
import { aiLogger } from "@/lib/obs/logger";
import { AppError } from "@/lib/errors/app-error";
import { getDb } from "@/lib/db/client";
import { aiModels, aiUsage } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "@/lib/utils/uuid";
import { openaiCompatibleAdapter } from "./adapters/openai-compatible";
import { anthropicAdapter } from "./adapters/anthropic";
import { geminiAdapter } from "./adapters/gemini";
import { extractJson } from "./adapters/shared";
import { isOpen, recordFailure, recordSuccess, withConcurrencyLimit } from "./circuit";
import { findDefaultProvider, findProviderWithSecret, protocolOf } from "./provider.repo";
import { findCachedAnnotation } from "./cache";
import type { AiAdapter, AiMessage, AiResult, Protocol } from "./types";

/**
 * AI Gateway：业务层唯一入口。
 * 全仓库禁止在别处直连厂商 SDK —— 这样才能统一做加密、缓存、重试、熔断与用量记录。
 */

const ADAPTERS: Record<Protocol, AiAdapter> = {
  openai_compatible: openaiCompatibleAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
};

/** 解密后的 Key 在进程内缓存 5 分钟，避免每次调用都解密 */
const keyCache = new Map<string, { key: string; expires: number }>();

async function resolveProvider(userId: string, providerId?: string) {
  const provider = providerId
    ? await findProviderWithSecret(userId, providerId)
    : await findDefaultProvider(userId);
  if (!provider) {
    throw new AppError("PROVIDER_AUTH_FAILED", "还没有可用的 AI Provider，请先在设置里添加");
  }
  if (isOpen(provider.id)) {
    throw new AppError("PROVIDER_CIRCUIT_OPEN");
  }

  const cached = keyCache.get(provider.id);
  const apiKey = cached && cached.expires > Date.now() ? cached.key : provider.apiKey;
  if (!cached || cached.expires <= Date.now()) {
    keyCache.set(provider.id, { key: provider.apiKey, expires: Date.now() + 5 * 60 * 1000 });
  }

  return { provider, apiKey };
}

async function modelFor(userId: string, providerId: string, role: "chat" | "vision" | "embedding"): Promise<string> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(aiModels)
    .where(and(eq(aiModels.providerId, providerId), eq(aiModels.role, role)))
    .limit(1);
  const name = rows[0]?.modelName;
  if (!name) throw new AppError("PROVIDER_MODEL_MISSING", `该 Provider 没有配置 ${role} 模型`);
  return name;
}

export interface GatewayInput {
  userId: string;
  task: "annotate" | "review" | "test" | "chat";
  providerId?: string;
  role?: "chat" | "vision" | "embedding";
  messages: AiMessage[];
  jsonMode?: boolean;
  schema?: ZodType<unknown>;
  timeoutMs?: number;
  /** 内容寻址缓存键；命中则 0 成本返回 */
  cacheKey?: string;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface GatewayOutput<T = unknown> {
  json: T | null;
  text: string;
  cached: boolean;
  lowConfidence: boolean;
  providerId: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; latencyMs: number };
}

const RETRY_STATUS_RETRYABLE = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MS = [1_000, 4_000, 15_000];

export async function runGateway<T = unknown>(input: GatewayInput): Promise<GatewayOutput<T>> {
  const { provider, apiKey } = await resolveProvider(input.userId, input.providerId);
  const protocol = protocolOf(provider);
  const adapter = ADAPTERS[protocol];
  const role = input.role ?? "chat";
  const model = await modelFor(input.userId, provider.id, role);

  // 1) 内容寻址缓存
  if (input.cacheKey) {
    const hit = await findCachedAnnotation(input.userId, input.cacheKey);
    if (hit) {
      aiLogger.info({ task: input.task, cached: true }, "AI 缓存命中");
      return {
        json: hit.content as T,
        text: JSON.stringify(hit.content),
        cached: true,
        lowConfidence: false,
        providerId: provider.id,
        model: hit.model,
        usage: { promptTokens: 0, completionTokens: 0, latencyMs: 0 },
      };
    }
  }

  const messages = input.messages;
  let lastError: unknown = null;
  let result: AiResult | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await withConcurrencyLimit(() =>
        adapter.chat(
          {
            model,
            messages,
            jsonMode: input.jsonMode ?? Boolean(input.schema),
            timeoutMs: input.timeoutMs ?? (input.task === "review" ? 180_000 : 60_000),
            onDelta: input.onDelta,
            signal: input.signal,
          },
          { baseUrl: provider.baseUrl, apiKey, overrides: provider.capabilities?.overrides },
        ),
      );
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      const status = (err as { details?: { status?: number } }).details?.status;
      const retryable =
        err instanceof AppError
          ? err.code === "AI_TIMEOUT" || (typeof status === "number" && RETRY_STATUS_RETRYABLE.has(status))
          : true;
      if (!retryable || attempt === 2) break;
      await sleep(BACKOFF_MS[attempt] ?? 15_000);
    }
  }

  if (!result) {
    recordFailure(provider.id);
    await recordUsage(input.userId, provider.id, model, input.task, 0, 0, 0, false, false);
    throw lastError instanceof AppError ? lastError : new AppError("PROVIDER_INCOMPATIBLE", "AI 调用失败");
  }

  // 2) 结构化输出校验；失败则换更严格的提示重试一次
  let parsed: unknown = null;
  let lowConfidence = false;
  if (input.schema) {
    parsed = extractJson(result.text);
    const check = input.schema.safeParse(parsed);
    if (!check.success) {
      const stricter: AiMessage[] = [
        ...messages,
        { role: "user", content: "上一段输出未能解析为合法 JSON。请重新输出，严格遵守：只输出一个 JSON 对象，键名与类型完全符合要求，不要包含解释、注释或代码围栏。" },
      ];
      try {
        const retry = await withConcurrencyLimit(() =>
          adapter.chat(
            { model, messages: stricter, jsonMode: true, timeoutMs: input.timeoutMs ?? 60_000 },
            { baseUrl: provider.baseUrl, apiKey, overrides: provider.capabilities?.overrides },
          ),
        );
        const retryParsed = extractJson(retry.text);
        const retryCheck = input.schema.safeParse(retryParsed);
        if (retryCheck.success) {
          parsed = retryCheck.data;
        } else {
          lowConfidence = true;
          aiLogger.warn({ task: input.task }, "AI 输出校验失败，回退纯文本");
        }
      } catch {
        lowConfidence = true;
      }
    } else {
      parsed = check.data;
    }
  }

  recordSuccess(provider.id);
  await recordUsage(
    input.userId,
    provider.id,
    model,
    input.task,
    result.promptTokens,
    result.completionTokens,
    result.latencyMs,
    false,
    true,
  );

  return {
    json: (parsed as T) ?? null,
    text: result.text,
    cached: false,
    lowConfidence,
    providerId: provider.id,
    model,
    usage: {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs: result.latencyMs,
    },
  };
}

/** 最小连通性测试：只发一条 16 token 的请求 */
export async function testProviderConnection(userId: string, providerId: string): Promise<{ ok: boolean; message: string; model: string }> {
  const { provider, apiKey } = await resolveProvider(userId, providerId);
  const model = await modelFor(userId, providerId, "chat");
  const adapter = ADAPTERS[protocolOf(provider)];
  try {
    const res = await adapter.chat(
      { model, messages: [{ role: "user", content: "回复两个字：可用" }], maxTokens: 16, timeoutMs: 15_000 },
      { baseUrl: provider.baseUrl, apiKey, overrides: provider.capabilities?.overrides },
    );
    recordSuccess(provider.id);
    return { ok: true, message: `连接成功（${res.text.trim().slice(0, 20) || "无返回文本"}）`, model };
  } catch (err) {
    recordFailure(provider.id);
    const appErr = err instanceof AppError ? err : new AppError("PROVIDER_INCOMPATIBLE");
    return { ok: false, message: appErr.message, model };
  }
}

async function recordUsage(
  userId: string,
  providerId: string,
  model: string,
  task: string,
  promptTokens: number,
  completionTokens: number,
  latencyMs: number,
  cached: boolean,
  ok: boolean,
): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(aiUsage).values({
      id: uuidv7(),
      userId,
      providerId,
      model,
      task,
      promptTokens,
      completionTokens,
      latencyMs,
      cached,
      ok,
    });
  } catch (err) {
    aiLogger.warn({ err }, "用量记录失败（不影响主流程）");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clearKeyCache() {
  keyCache.clear();
}
