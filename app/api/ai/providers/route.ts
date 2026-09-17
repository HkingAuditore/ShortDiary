import type { NextRequest } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { createProvider, listProviders } from "@/lib/ai/provider.repo";
import { providerImportSchema } from "@/lib/ai/schemas";
import { PROTOCOL_DEFAULT_BASE_URL } from "@/lib/ai/types";
import { AppError } from "@/lib/errors/app-error";

export const dynamic = "force-dynamic";

export const GET = defineRoute(async () => {
  const ctx = await serviceContext();
  const list = await listProviders(ctx.userId);
  return { data: list };
});

/** 兼容两种输入：直接表单（camelCase）与粘贴导入（snake_case JSON） */
const formSchema = z.object({
  name: z.string().min(1).max(60),
  protocol: z.enum(["openai_compatible", "anthropic", "gemini"]),
  baseUrl: z.string().min(4).max(300),
  apiKey: z.string().min(4).max(500),
  models: z.object({ chat: z.string().min(1).max(120), vision: z.string().max(120).optional(), embedding: z.string().max(120).optional() }),
  capabilities: z.object({ vision: z.boolean().optional(), embedding: z.boolean().optional(), json: z.boolean().optional() }).optional(),
  isDefault: z.boolean().optional(),
});

const createSchema = z.union([providerImportSchema, formSchema]);

function normalize(raw: z.infer<typeof providerImportSchema> | z.infer<typeof formSchema>) {
  if ("base_url" in raw) {
    const models = raw.models ?? {};
    return {
      name: raw.name,
      protocol: raw.protocol,
      baseUrl: raw.base_url,
      apiKey: raw.api_key,
      capabilities: raw.capabilities ?? {},
      models: [
        ...(models.chat ? [{ role: "chat", modelName: models.chat }] : []),
        ...(models.vision ? [{ role: "vision", modelName: models.vision }] : []),
        ...(models.embedding ? [{ role: "embedding", modelName: models.embedding }] : []),
      ],
      isDefault: false,
    };
  }
  return {
    name: raw.name,
    protocol: raw.protocol,
    baseUrl: raw.baseUrl || PROTOCOL_DEFAULT_BASE_URL[raw.protocol],
    apiKey: raw.apiKey,
    capabilities: raw.capabilities ?? {},
    models: [
      { role: "chat", modelName: raw.models.chat },
      ...(raw.models.vision ? [{ role: "vision", modelName: raw.models.vision }] : []),
      ...(raw.models.embedding ? [{ role: "embedding", modelName: raw.models.embedding }] : []),
    ],
    isDefault: raw.isDefault ?? false,
  };
}

export const POST = defineRoute(async (req: NextRequest) => {
  const ctx = await serviceContext();
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw AppError.invalidInput("Provider 配置格式不正确", parsed.error.issues.map((i) => i.path.join(".")));
  }
  const input = normalize(parsed.data);
  const created = await createProvider(ctx.userId, input);
  return { data: created, status: 201 };
});
