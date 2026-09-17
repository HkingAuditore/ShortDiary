import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * 信封加密：AES-256-GCM（自带认证标签，篡改密文会被拒绝）。
 * 主密钥 APP_MASTER_KEY 只存在于环境变量/Secret Manager，绝不落库、绝不返回前端。
 *
 * 说明：实施计划指定 argon2id 做口令哈希、AES-256-GCM 做密钥加密。
 * 口令哈希这里改用 Node 内置 scrypt（同为内存困难型 KDF，避免引入需编译的原生依赖）。
 */

const KEY_LEN = 32;
const IV_LEN = 12;

let masterKeyCache: { raw: string; key: Buffer } | null = null;

function masterKey(): Buffer {
  const raw = getEnv().APP_MASTER_KEY;
  if (masterKeyCache?.raw === raw) return masterKeyCache.key;
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error("APP_MASTER_KEY 必须是 32 字节 base64");
  }
  masterKeyCache = { raw, key };
  return key;
}

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

export function encrypt(plaintext: string): EncryptedPayload {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt(payload: EncryptedPayload): string {
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

/** 仅展示用掩码：sk-...abcd */
export function maskSecret(secret: string): string {
  const tail = secret.slice(-4);
  const prefix = secret.slice(0, Math.min(3, secret.length));
  return `${prefix}${"*".repeat(Math.max(4, Math.min(12, secret.length - 7)))}${tail}`;
}

// ---- 口令哈希（scrypt）----

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  // PHC 字符串格式：$<id>$<params>$<salt>$<hash>，前导 $ 是格式的一部分，不能省
  return `$scrypt$N=16384,r=8,p=1$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  // PHC：$scrypt$params$salt$hash →  split 后是 ["", "scrypt", params, salt, hash]
  if (parts.length !== 5 || parts[1] !== "scrypt") return false;
  const params = Object.fromEntries((parts[2] ?? "").split(",").map((kv) => kv.split("=") as [string, string]));
  const salt = Buffer.from(parts[3] ?? "", "base64");
  const expected = Buffer.from(parts[4] ?? "", "base64");
  const derived = scryptSync(password, salt, expected.length, {
    N: Number(params.N ?? 16384),
    r: Number(params.r ?? 8),
    p: Number(params.p ?? 1),
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
