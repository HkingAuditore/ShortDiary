/**
 * UUIDv7：时间有序的 128 位标识。
 * 相比 v4，索引局部性接近自增 BIGINT，避免 B-tree 页分裂与 WAL 放大；
 * 相比自增 ID，不泄露数据量且天然支持未来分库。
 * 在应用层生成，不依赖数据库扩展（uuid_generate_v7 在 PGlite 下不可用）。
 */

let lastMs = 0;
let counter = 0;

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function uuidv7(at?: number): string {
  const ms = at ?? Date.now();
  if (ms === lastMs) {
    counter += 1;
  } else {
    lastMs = ms;
    counter = Math.floor(Math.random() * 0x400);
  }
  const seq = counter & 0xfff;

  const hex = ms.toString(16).padStart(12, "0");
  // 段长必须是 8-4-4-4-12：最后一段 6 字节（12 个 hex 字符）
  const randA = randomHex(2);
  const randB = randomHex(6);

  const timeHigh = hex.slice(0, 8);
  const timeMid = hex.slice(8, 12);
  // version 7 + 12 位序列/随机数
  const verSeq = ((7 << 12) | seq).toString(16).padStart(4, "0");
  const variantByte = ((Number.parseInt(randA.slice(0, 2), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");

  return `${timeHigh}-${timeMid}-${verSeq}-${variantByte}${randA.slice(2)}-${randB}`;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
