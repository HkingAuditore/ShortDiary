import type { NextRequest } from "next/server";
import { defineRoute, type RouteCtx } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { testProviderConnection } from "@/lib/ai/gateway";
import { recordTestResult } from "@/lib/ai/provider.repo";

export const dynamic = "force-dynamic";

/**
 * 最小连通性测试：只发一条 16 token 的请求。
 * 返回「连接成功 / 认证失败 / 模型不存在 / Endpoint 不兼容」四类可理解结果。
 */
export const POST = defineRoute(
  async (_req: NextRequest, ctx: RouteCtx) => {
    const sctx = await serviceContext();
    const id = ctx.params.id ?? "";
    const result = await testProviderConnection(sctx.userId, id);
    await recordTestResult(sctx.userId, id, result.ok);
    return { data: result };
  },
  { rateLimit: { limit: 20 } },
);
