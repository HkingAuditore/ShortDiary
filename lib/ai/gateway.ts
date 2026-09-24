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
import { BUILTIN_PROVIDER_ID, builtinForced, builtinModel, builtinProvider, type AiRole } from "./builtin";
import type { ProviderOverrides } from "@/lib/db/schema";
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

interface ResolvedProvider {
  id: string;
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  overrides?: ProviderOverrides;
  /** true 表示命中系统内置默认，落库时 providerId 记为 null */
  builtin: boolean;
}

/**
 * 解析本次调用使用的 Provider，优先级：
 * 1) 显式指定 / 用户默认的自建 Provider（除非 AI_DEFAULT_FORCE=true）
 * 2) 系统内置默认（AI_DEFAULT_API_KEY 配置了才存在）
 * 3) 都没有 → 报错引导去设置页
 */
async function resolveProvider(userId: string, providerId?: string): Promise<ResolvedProvider> {
  // 哨兵 id 不是合法 uuid，直接查库会让 Postgres 抛 invalid input syntax for type uuid
  if (!builtinForced() && providerId !== BUILTIN_PROVIDER_ID) {
    const provider = providerId ? await findProviderWithSecret(userId, providerId) : await findDefaultProvider(userId);
    if (provider) {
      if (isOpen(provider.id)) throw new AppError("PROVIDER_CIRCUIT_OPEN");

      const cached = keyCache.get(provider.id);
      const apiKey = cached && cached.expires > Date.now() ? cached.key : provider.apiKey;
      if (!cached || cached.expires <= Date.now()) {
        keyCache.set(provider.id, { key: provider.apiKey, expires: Date.now() + 5 * 60 * 1000 });
      }

      return {
        id: provider.id,
        protocol: protocolOf(provider),
        baseUrl: provider.baseUrl,
        apiKey,
        overrides: provider.capabilities?.overrides,
        builtin: false,
      };
    }
  }

  const builtin = builtinProvider();
  if (builtin) {
    if (isOpen(BUILTIN_PROVIDER_ID)) throw new AppError("PROVIDER_CIRCUIT_OPEN");
    return {
      id: builtin.id,
      protocol: builtin.protocol,
      baseUrl: builtin.baseUrl,
      apiKey: builtin.apiKey,
      overrides: builtin.overrides,
      builtin: true,
    };
  }

  throw new AppError("PROVIDER_AUTH_FAILED", "还没有可用的 AI Provider，请先在设置里添加");
}

async function modelFor(userId: string, providerId: string, role: AiRole): Promise<string> {
  if (providerId === BUILTIN_PROVIDER_ID) {
    const name = builtinModel(role);
    if (!name) throw new AppError("PROVIDER_MODEL_MISSING", `内置默认 Provider 没有配置 ${role} 模型`);
    return name;
  }
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
  role?: AiRole;
  messages: AiMessage[];
  jsonMode?: boolean;
  schema?: ZodType<unknown>;
  timeoutMs?: number;
  /** 内容寻址缓存键；命中则 0 成本返回 */
  cacheKey?: string;
  /** 结构化重试时附上的「期望形状」说明（例：{"reaction": "..."}），帮模型把键名写对 */
  schemaHint?: string;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface GatewayOutput<T = unknown> {
  json: T | null;
  text: string;
  cached: boolean;
  lowConfidence: boolean;
  /** 命中系统内置默认时为 null（内置没有 DB 行，不能写 uuid 外键列） */
  providerId: string | null;
  model: string;
  usage: { promptTokens: number; completionTokens: number; latencyMs: number };
}

const RETRY_STATUS_RETRYABLE = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MS = [1_000, 4_000, 15_000];

export async function runGateway<T = unknown>(input: GatewayInput): Promise<GatewayOutput<T>> {
  const provider = await resolveProvider(input.userId, input.providerId);
  const adapter = ADAPTERS[provider.protocol];
  const role = input.role ?? "chat";
  const model = await modelFor(input.userId, provider.id, role);
  const usageProviderId = provider.builtin ? null : provider.id;

  // 1) 内容寻址缓存
  if (input.cacheKey) {
    const hit = await findCachedAnnotation(input.userId, input.cacheKey);
    // 缓存里可能存着历史上校验失败的裸 JSON（旧代码会存），命中它等于永远修不好
    const hitValid = hit ? !input.schema || input.schema.safeParse(hit.content).success : false;
    if (hit && !hitValid) {
      aiLogger.warn({ task: input.task, cacheKey: input.cacheKey }, "缓存内容未通过校验，忽略并重新生成");
    }
    if (hit && hitValid) {
      aiLogger.info({ task: input.task, cached: true }, "AI 缓存命中");
      return {
        json: hit.content as T,
        text: JSON.stringify(hit.content),
        cached: true,
        lowConfidence: false,
        providerId: usageProviderId,
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
          { baseUrl: provider.baseUrl, apiKey: provider.apiKey, overrides: provider.overrides },
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
    await recordUsage(input.userId, usageProviderId, model, input.task, 0, 0, 0, false, false);
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
        {
          role: "user",
          content: [
            "上一段输出未能解析为合法 JSON。请重新输出，严格遵守：只输出一个 JSON 对象，",
            "键名与类型完全符合要求，不要包含解释、注释或代码围栏。",
            input.schemaHint ? `期望形状：${input.schemaHint}（键名必须完全一致，不要改名）。` : "",
          ]
            .filter(Boolean)
            .join(""),
        },
      ];
      try {
        const retry = await withConcurrencyLimit(() =>
          adapter.chat(
            { model, messages: stricter, jsonMode: true, timeoutMs: input.timeoutMs ?? 60_000 },
            { baseUrl: provider.baseUrl, apiKey: provider.apiKey, overrides: provider.overrides },
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
    usageProviderId,
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
    providerId: usageProviderId,
    model,
    usage: {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs: result.latencyMs,
    },
  };
}

/**
 * 最小连通性测试：只发一条短请求。
 * 上限给到 256 而不是 16 —— 推理型模型（如 hy4-preview）会先把预算烧在
 * reasoning_content 上，16 token 时 content 恒为空，会被误判成「Endpoint 不兼容」。
 */
export async function testProviderConnection(userId: string, providerId: string): Promise<{ ok: boolean; message: string; model: string }> {
  const provider = await resolveProvider(userId, providerId);
  const model = await modelFor(userId, provider.id, "chat");
  const adapter = ADAPTERS[provider.protocol];
  try {
    const res = await adapter.chat(
      { model, messages: [{ role: "user", content: "回复两个字：可用" }], maxTokens: 256, timeoutMs: 15_000 },
      { baseUrl: provider.baseUrl, apiKey: provider.apiKey, overrides: provider.overrides },
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
  providerId: string | null,
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
