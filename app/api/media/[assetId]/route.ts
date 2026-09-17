import type { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { defineRoute, type RouteCtx } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { findAssetById } from "@/lib/asset/asset.repo";
import { readStreamFor, readUrlFor, driverName } from "@/lib/storage";
import { AppError } from "@/lib/errors/app-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 图片读取统一入口：
 * - COS 驱动：302 到短期签名 URL（URL 不永久公开）
 * - 本地驱动：鉴权后流式返回
 * 两种模式下前端拿到的都是同一个稳定地址。
 */
export const GET = defineRoute(async (_req: NextRequest, ctx: RouteCtx) => {
  const sctx = await serviceContext();
  const asset = await findAssetById(sctx.userId, ctx.params.assetId ?? "");
  if (!asset) throw AppError.notFound("图片不存在");

  if (driverName() === "cos") {
    const signed = await readUrlFor(asset.cosKey, 900);
    if (!signed) throw new AppError("STORAGE_FAILED", "无法生成图片访问地址");
    return new Response(null, {
      status: 302,
      headers: { Location: signed, "Cache-Control": "private, max-age=600" },
    }) as never;
  }

  const ROOT = resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? ".data/uploads");
  const full = join(ROOT, asset.cosKey);
  if (!full.startsWith(ROOT + sep)) throw AppError.forbidden("非法的存储路径");

  let size: number;
  try {
    size = statSync(full).size;
  } catch {
    throw AppError.notFound("图片文件已丢失");
  }

  const stream = Readable.toWeb(readStreamFor(asset.cosKey)) as ReadableStream;
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": asset.mimeType,
      "content-length": String(size),
      "cache-control": "private, max-age=600",
    },
  }) as never;
});
