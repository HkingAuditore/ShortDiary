import type { NextRequest } from "next/server";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { builtinInfo } from "@/lib/ai/builtin";
import { BUILTIN_PROVIDER_ID } from "@/lib/ai/builtin";
import { testProviderConnection } from "@/lib/ai/gateway";
import { AppError } from "@/lib/errors/app-error";

export const dynamic = "force-dynamic";

/**
 * 系统内置默认 AI 的只读状态。
 * 只返回名称 / Endpoint / 模型名 / 脱敏后的密钥尾号 —— 明文密钥永远不出服务端。
 */
export const GET = defineRoute(async () => {
  await serviceContext();
  return { data: builtinInfo() };
});

/** 连通性自检：发一条 16 token 的请求，便于部署后确认密钥与模型可用 */
export const POST = defineRoute(
  async (_req: NextRequest) => {
    const ctx = await serviceContext();
    if (!builtinInfo().enabled) {
      throw new AppError("PROVIDER_AUTH_FAILED", "服务端未配置内置默认 AI（AI_DEFAULT_API_KEY 为空）");
    }
    const result = await testProviderConnection(ctx.userId, BUILTIN_PROVIDER_ID);
    return { data: result };
  },
  { rateLimit: { limit: 20 } },
);
