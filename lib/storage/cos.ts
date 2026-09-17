import COS from "cos-nodejs-sdk-v5";
import { getEnv } from "@/lib/env";
import { storageLogger } from "@/lib/obs/logger";
import { AppError } from "@/lib/errors/app-error";

/**
 * 腾讯云 COS 适配器。只在配置了 COS_* 时启用；
 * 应用服务器只做签名签发，文件字节直传 COS，不经应用服务器中转。
 */

let client: COS | null = null;

function cos(): COS {
  if (client) return client;
  const env = getEnv();
  if (!env.COS_SECRET_ID || !env.COS_SECRET_KEY) {
    throw new AppError("STORAGE_FAILED", "COS 密钥未配置");
  }
  client = new COS({ SecretId: env.COS_SECRET_ID, SecretKey: env.COS_SECRET_KEY });
  return client;
}

function bucketConfig() {
  const env = getEnv();
  return { Bucket: env.COS_BUCKET!, Region: env.COS_REGION! };
}

function promisify<T>(fn: (cb: (err: COS.CosError | null, data: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, data) => (err ? reject(err) : resolve(data)));
  });
}

/** 签发直传用的 PUT 签名 URL（默认 15 分钟有效） */
export async function signPutUrl(key: string, expiresSec = 900, contentType?: string): Promise<string> {
  const data = await promisify<{ Url: string }>((cb) =>
    cos().getObjectUrl(
      {
        ...bucketConfig(),
        Key: key,
        Method: "PUT",
        Expires: expiresSec,
        Sign: true,
        ...(contentType ? { Headers: { "content-type": contentType } } : {}),
      },
      cb as never,
    ),
  );
  return data.Url;
}

export async function signGetUrl(key: string, expiresSec = 900): Promise<string> {
  const data = await promisify<{ Url: string }>((cb) =>
    cos().getObjectUrl({ ...bucketConfig(), Key: key, Method: "GET", Expires: expiresSec, Sign: true }, cb as never),
  );
  const env = getEnv();
  if (env.COS_CDN_DOMAIN) {
    // CDN 域名 + 签名参数：保持签名有效期的同时享受边缘缓存
    return data.Url.replace(/^https?:\/\/[^/]+/, `https://${env.COS_CDN_DOMAIN}`);
  }
  return data.Url;
}

export async function cosDelete(key: string): Promise<void> {
  try {
    await promisify((cb) => cos().deleteObject({ ...bucketConfig(), Key: key }, cb as never));
  } catch (err) {
    storageLogger.warn({ err, keyLen: key.length }, "COS 删除失败");
    throw new AppError("STORAGE_FAILED");
  }
}

export async function cosExists(key: string): Promise<boolean> {
  try {
    await promisify((cb) => cos().headObject({ ...bucketConfig(), Key: key }, cb as never));
    return true;
  } catch {
    return false;
  }
}

/** 数据万象：缩略 + 转码（AVIF/WebP 由 Accept 协商后决定） */
export function ciPreviewUrl(key: string, width: number, format: "avif" | "webp" | "jpg" = "webp"): string {
  const env = getEnv();
  const base = env.COS_CDN_DOMAIN
    ? `https://${env.COS_CDN_DOMAIN}/${key}`
    : `https://${env.COS_BUCKET}.cos.${env.COS_REGION}.myqcloud.com/${key}`;
  return `${base}?imageMogr2/thumbnail/${width}/format/${format}/interlace/1`;
}

export async function cosSmokeTest(): Promise<{ ok: boolean; step: string; detail?: string }> {
  const key = `tmp/smoke/${Date.now()}.txt`;
  try {
    const putUrl = await signPutUrl(key, 300, "text/plain");
    const res = await fetch(putUrl, { method: "PUT", body: "paper-journal smoke test" });
    if (!res.ok) return { ok: false, step: "PUT", detail: `HTTP ${res.status}` };
    const getUrl = await signGetUrl(key, 300);
    const got = await fetch(getUrl);
    if (!got.ok) return { ok: false, step: "GET", detail: `HTTP ${got.status}` };
    await cosDelete(key);
    return { ok: true, step: "done" };
  } catch (err) {
    return { ok: false, step: "error", detail: (err as Error).message };
  }
}
