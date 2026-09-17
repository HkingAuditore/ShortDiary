/**
 * 游标（keyset）分页。禁止 OFFSET：时间线深度翻页时 OFFSET 线性退化，
 * 且翻页期间插入会导致重复/漏读。
 */

export interface TimelineCursor {
  entryDate: string; // YYYY-MM-DD
  createdAt: string; // ISO
  id: string;
}

export function encodeCursor(c: TimelineCursor): string {
  const raw = [c.entryDate, new Date(c.createdAt).toISOString(), c.id].join("|");
  return Buffer.from(raw, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): TimelineCursor | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [entryDate, createdAt, id] = raw.split("|");
    if (!entryDate || !createdAt || !id) return null;
    if (Number.isNaN(Date.parse(createdAt))) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return null;
    return { entryDate, createdAt, id };
  } catch {
    return null;
  }
}

export function clampLimit(value: unknown, fallback = 30, max = 100): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
