import type { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { verifyLocalToken } from "@/lib/storage";
import { MAX_IMAGE_BYTES } from "@/lib/storage/key-convention";
import { AppError } from "@/lib/errors/app-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROOT = resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? ".data/uploads");

/**
 * 本地磁盘驱动的接收端点（未配置 COS 时使用）。
 * key 由服务端签发并用 HMAC 令牌保护，客户端无法改写写入路径。
 * 流式落盘，不在内存中缓存整个文件。
 */
export const POST = defineRoute(async (req: NextRequest) => {
  const ctx = await serviceContext();
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const token = url.searchParams.get("token") ?? "";

  if (!key || !verifyLocalToken(key, token)) throw new AppError("FORBIDDEN", "上传凭证无效或已过期");
  if (!key.startsWith(`tmp/${ctx.userId}/`) && !key.startsWith(`u/${ctx.userId}/`)) {
    throw new AppError("FORBIDDEN", "上传路径不属于当前用户");
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "图片过大");

  const full = join(ROOT, normalize(key));
  if (!full.startsWith(ROOT + sep)) throw new AppError("FORBIDDEN", "非法的存储路径");
  mkdirSync(dirname(full), { recursive: true });

  let written = 0;
  if (!req.body) throw new AppError("INVALID_INPUT", "请求体为空");

  await pipeline(
    Readable.fromWeb(req.body as never),
    async function* (source) {
      for await (const chunk of source) {
        written += (chunk as Buffer).length;
        if (written > MAX_IMAGE_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "图片过大");
        yield chunk as Buffer;
      }
    },
    createWriteStream(full),
  );

  return { data: { key, sizeBytes: written }, status: 201 };
});
