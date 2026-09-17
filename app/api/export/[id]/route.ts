import type { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { defineRoute, type RouteCtx } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { findExport } from "@/lib/export/export.service";
import { readObjectBytes } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 下载导出包（本地驱动直接流式返回；COS 驱动 302 到 15 分钟有效的签名地址） */
export const GET = defineRoute(async (_req: NextRequest, ctx: RouteCtx) => {
  const sctx = await serviceContext();
  const record = await findExport(sctx, ctx.params.id ?? "");
  const bytes = await readObjectBytes(record.storageKey);

  if (!bytes) {
    return new Response("导出文件已过期，请重新生成", { status: 410 }) as never;
  }

  return new Response(Readable.toWeb(Readable.from(bytes)) as ReadableStream, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-length": String(bytes.length),
      "content-disposition": `attachment; filename="${record.filename.replace(/[^\w.\-一-龥]/g, "_")}"`,
      "cache-control": "private, no-store",
    },
  }) as never;
});
