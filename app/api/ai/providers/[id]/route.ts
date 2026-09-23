import type { NextRequest } from "next/server";
import { z } from "zod";
import { defineRoute, type RouteCtx } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { deleteProvider, updateProvider } from "@/lib/ai/provider.repo";
import { BUILTIN_PROVIDER_ID } from "@/lib/ai/builtin";
import { AppError } from "@/lib/errors/app-error";

export const dynamic = "force-dynamic";

/** 内置默认由环境变量提供、不属于任何用户，不接受改删；哨兵 id 也不是合法 uuid */
function rejectBuiltin(id: string) {
  if (id === BUILTIN_PROVIDER_ID) throw AppError.notFound("内置默认 Provider 由服务端配置，不可修改或删除");
}

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  protocol: z.enum(["openai_compatible", "anthropic", "gemini"]).optional(),
  baseUrl: z.string().min(4).max(300).optional(),
  // 输入新 Key 即覆盖密文，旧 Key 不再可恢复；未传则不改动
  apiKey: z.string().min(4).max(500).optional(),
  capabilities: z.object({ vision: z.boolean().optional(), embedding: z.boolean().optional(), json: z.boolean().optional() }).optional(),
  models: z.object({ chat: z.string().min(1).max(120), vision: z.string().max(120).optional(), embedding: z.string().max(120).optional() }).optional(),
  isDefault: z.boolean().optional(),
});

export const PATCH = defineRoute(async (req: NextRequest, ctx: RouteCtx) => {
  const sctx = await serviceContext();
  const id = ctx.params.id ?? "";
  rejectBuiltin(id);
  const body = patchSchema.parse(await req.json());
  const updated = await updateProvider(sctx.userId, id, {
    name: body.name,
    protocol: body.protocol,
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    capabilities: body.capabilities,
    isDefault: body.isDefault,
    models: body.models
      ? [
          { role: "chat", modelName: body.models.chat },
          ...(body.models.vision ? [{ role: "vision", modelName: body.models.vision }] : []),
          ...(body.models.embedding ? [{ role: "embedding", modelName: body.models.embedding }] : []),
        ]
      : undefined,
  });
  return { data: updated };
});

/** 删除即彻底清理密钥密文 */
export const DELETE = defineRoute(async (_req: NextRequest, ctx: RouteCtx) => {
  const sctx = await serviceContext();
  const id = ctx.params.id ?? "";
  rejectBuiltin(id);
  const ok = await deleteProvider(sctx.userId, id);
  if (!ok) throw AppError.notFound("Provider 不存在");
  return { data: { ok: true } };
});
