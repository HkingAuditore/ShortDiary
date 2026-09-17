import { createHash } from "node:crypto";

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * 内容寻址键：AI 结果的缓存键。
 * inputHash = sha256(promptVersion + model + 输入内容哈希集合)
 */
export function contentHash(...parts: Array<string | string[]>): string {
  const flat = parts.map((p) => (Array.isArray(p) ? p.slice().sort().join(",") : p)).join("|");
  return sha256(flat);
}

export async function sha256Browser(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
