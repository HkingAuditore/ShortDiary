import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors/app-error";
import { buildObjectKey, buildTempKey } from "./key-convention";
import { localDelete, localExists, localPut, localReadStream } from "./local";
import { ciPreviewUrl, cosDelete, cosExists, signGetUrl, signPutUrl } from "./cos";

/**
 * 存储门面：业务层只认识这里的方法，不认识 COS 或本地磁盘。
 * 驱动由 STORAGE_DRIVER / COS_* 配置决定。
 */

export interface UploadTicket {
  driver: "cos" | "local";
  key: string;
  /** 直传地址：COS 为签名 URL，本地驱动为应用内的接收端点 */
  url: string;
  method: "PUT" | "POST";
  headers?: Record<string, string>;
  token?: string;
  expiresIn: number;
}

const UPLOAD_TTL = 900;

export function driverName(): "cos" | "local" {
  return getEnv().storageDriver;
}

/** 本地驱动的写入令牌：服务端签发，客户端无法伪造或改写 key */
export function signLocalToken(key: string, ttlSec = UPLOAD_TTL): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${key}.${expires}`;
  const sig = createHmac("sha256", getEnv().APP_MASTER_KEY).update(payload).digest("base64url");
  return `${expires}.${sig}`;
}

export function verifyLocalToken(key: string, token: string): boolean {
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = createHmac("sha256", getEnv().APP_MASTER_KEY)
    .update(`${key}.${exp}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function issueUploadTicket(params: {
  userId: string;
  mime: string;
  entryDate?: string;
  temp?: boolean;
}): Promise<UploadTicket> {
  const { userId, mime, entryDate, temp } = params;
  const key = temp || !entryDate ? buildTempKey(userId, mime) : buildObjectKey(userId, entryDate, mime);

  if (driverName() === "cos") {
    const url = await signPutUrl(key, UPLOAD_TTL, mime);
    return { driver: "cos", key, url, method: "PUT", headers: { "content-type": mime }, expiresIn: UPLOAD_TTL };
  }

  return {
    driver: "local",
    key,
    url: "/api/uploads/local",
    method: "POST",
    token: signLocalToken(key),
    expiresIn: UPLOAD_TTL,
  };
}

export async function readUrlFor(key: string, ttl = 900): Promise<string | null> {
  if (driverName() === "cos") return signGetUrl(key, ttl);
  return null; // 本地驱动：一律经 /api/media/<assetId> 鉴权后流式返回
}

export async function previewUrlFor(
  key: string,
  width: number,
  format: "avif" | "webp" | "jpg" = "webp",
): Promise<string | null> {
  if (driverName() === "cos") return ciPreviewUrl(key, width, format);
  return null;
}

export async function putObject(key: string, bytes: Buffer | Uint8Array): Promise<void> {
  if (driverName() === "cos") {
    const url = await signPutUrl(key, 300);
    const res = await fetch(url, { method: "PUT", body: bytes as BodyInit });
    if (!res.ok) throw new AppError("STORAGE_FAILED", "上传到对象存储失败");
    return;
  }
  await localPut(key, bytes);
}

export async function deleteObject(key: string): Promise<void> {
  if (driverName() === "cos") return cosDelete(key);
  await localDelete(key);
}

/** 读取对象字节：仅用于导出打包与本地驱动的图片读取，日常展示不走这里 */
export async function readObjectBytes(key: string): Promise<Buffer | null> {
  if (driverName() === "cos") {
    const url = await signGetUrl(key, 300);
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  const { readFile } = await import("node:fs/promises");
  const { localAbsolutePath } = await import("./local");
  try {
    return await readFile(localAbsolutePath(key));
  } catch {
    return null;
  }
}

export async function objectExists(key: string): Promise<boolean> {
  if (driverName() === "cos") return cosExists(key);
  return localExists(key);
}

export function readStreamFor(key: string) {
  if (driverName() === "cos") throw new AppError("STORAGE_FAILED", "COS 驱动应走签名 URL");
  return localReadStream(key);
}

export { buildObjectKey, buildTempKey, isTempKey, ALLOWED_IMAGE_MIMES, MAX_IMAGE_BYTES } from "./key-convention";
