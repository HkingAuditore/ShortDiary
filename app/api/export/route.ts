import type { NextRequest } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { buildExport, importEntries, latestExports } from "@/lib/export/export.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createSchema = z.object({
  kind: z.enum(["json", "markdown", "zip"]).default("zip"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** 创建导出包。数据量大时应转后台任务，V1 单用户数据量可控，同步生成后返回下载地址 */
export const POST = defineRoute(
  async (req: NextRequest) => {
    const ctx = await serviceContext();
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const result = await buildExport(ctx, body);
    return { data: result, status: 201 };
  },
  { rateLimit: { limit: 10 } },
);

export const GET = defineRoute(async () => {
  const ctx = await serviceContext();
  return { data: await latestExports(ctx) };
});

const importSchema = z.object({
  manifest: z.object({ schemaVersion: z.number().optional() }).optional(),
  entries: z
    .array(
      z.object({
        id: z.string().optional(),
        entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().optional(),
        content: z.string(),
      }),
    )
    .min(1)
    .max(20000),
});

/** 恢复导入：先校验 schema_version，再幂等写入 */
export const PUT = defineRoute(async (req: NextRequest) => {
  const ctx = await serviceContext();
  const body = importSchema.parse(await req.json());
  const result = await importEntries(ctx, body);
  return { data: result, status: 201 };
});
