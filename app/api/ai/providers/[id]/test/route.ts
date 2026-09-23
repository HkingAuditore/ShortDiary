import type { NextRequest } from "next/server";
import { defineRoute, type RouteCtx } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { testProviderConnection } from "@/lib/ai/gateway";
import { recordTestResult } from "@/lib/ai/provider.repo";
import { BUILTIN_PROVIDER_ID } from "@/lib/ai/builtin";

export const dynamic = "force-dynamic";

/**
 * 最小连通性测试：只发一条短请求（推理型模型需要留出 reasoning 预算）。
 * 返回「连接成功 / 认证失败 / 模型不存在 / Endpoint 不兼容」四类可理解结果。
 */
export const POST = defineRoute(
  async (_req: NextRequest, ctx: RouteCtx) => {
    const sctx = await serviceContext();
    const id = ctx.params.id ?? "";
    const result = await testProviderConnection(sctx.userId, id);
    // 内置默认没有 DB 行，跳过测试结果的落库（哨兵 id 非 uuid，写库会报错）
    if (id !== BUILTIN_PROVIDER_ID) await recordTestResult(sctx.userId, id, result.ok);
    return { data: result };
  },
  { rateLimit: { limit: 20 } },
);
