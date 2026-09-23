import { getEnv } from "@/lib/env";
import { maskSecret } from "@/lib/crypto/envelope";
import type { ProviderOverrides } from "@/lib/db/schema";
import type { Protocol } from "./types";

/**
 * 内置默认 AI Provider（系统级兜底）。
 *
 * 设计要点：
 * - 密钥只从服务端环境变量读取，不落库、不进代码、不返回给浏览器。
 *   DB 里存 Provider 的那套信封加密（APP_MASTER_KEY）在这里不需要 ——
 *   环境变量本身就是部署平台的密钥管理能力。
 * - 没有配置 AI_DEFAULT_API_KEY 时整体停用，用户自建 Provider 的行为完全不变。
 * - 用一个非 uuid 的哨兵 id，与用户 Provider 明确区分；写入 ai_usage / ai_annotations
 *   时映射成 null，避免撞 uuid 列与外键。
 */

export const BUILTIN_PROVIDER_ID = "builtin:default";

export type AiRole = "chat" | "vision" | "embedding";

export interface BuiltinProvider {
  id: typeof BUILTIN_PROVIDER_ID;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  overrides: ProviderOverrides;
}

/** 读取内置默认；未配置密钥时返回 null */
export function builtinProvider(): BuiltinProvider | null {
  const env = getEnv();
  const apiKey = env.AI_DEFAULT_API_KEY;
  if (!apiKey) return null;
  return {
    id: BUILTIN_PROVIDER_ID,
    name: env.AI_DEFAULT_NAME,
    protocol: "openai_compatible",
    baseUrl: env.AI_DEFAULT_BASE_URL.replace(/\/$/, ""),
    apiKey,
    overrides: {
      supportsSystemRole: true,
      supportsJsonMode: env.AI_DEFAULT_JSON_MODE,
    },
  };
}

/** 内置默认在各角色下的模型名；未配置则返回 null（由调用方报「模型缺失」） */
export function builtinModel(role: AiRole): string | null {
  const env = getEnv();
  if (!env.AI_DEFAULT_API_KEY) return null;
  if (role === "chat") return env.AI_DEFAULT_MODEL;
  if (role === "vision") return env.AI_DEFAULT_VISION_MODEL ?? null;
  return null;
}

export interface BuiltinInfo {
  id: string;
  /** 是否已启用（有密钥即启用） */
  enabled: boolean;
  /** true 时忽略用户自建 Provider，全部走内置 */
  forced: boolean;
  name: string;
  baseUrl: string;
  model: string;
  visionModel: string | null;
  /** 脱敏后的密钥提示，仅用于界面核对，不含可用密钥 */
  keyHint: string | null;
  jsonMode: boolean;
}

/** 给设置页/接口用的只读快照：任何情况下都不包含明文密钥 */
export function builtinInfo(): BuiltinInfo {
  const env = getEnv();
  const enabled = Boolean(env.AI_DEFAULT_API_KEY);
  return {
    id: BUILTIN_PROVIDER_ID,
    enabled,
    forced: env.AI_DEFAULT_FORCE,
    name: env.AI_DEFAULT_NAME,
    baseUrl: env.AI_DEFAULT_BASE_URL,
    model: env.AI_DEFAULT_MODEL,
    visionModel: env.AI_DEFAULT_VISION_MODEL ?? null,
    keyHint: enabled ? maskSecret(env.AI_DEFAULT_API_KEY as string) : null,
    jsonMode: env.AI_DEFAULT_JSON_MODE,
  };
}

/** 内置默认是否是强制模式（调用方据此决定是否跳过用户 Provider 查找） */
export function builtinForced(): boolean {
  return getEnv().AI_DEFAULT_FORCE;
}
