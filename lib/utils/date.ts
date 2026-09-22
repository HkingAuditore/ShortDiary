/**
 * 日期工具：全部以用户时区计算「属于哪一天」（entry_date），
 * 存储层统一 UTC timestamptz，展示层才换算。
 */

export function dateInTimeZone(input: Date | string | number, timeZone: string): string {
  const d = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function timeInTimeZone(input: Date | string | number, timeZone: string): string {
  const d = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function today(timeZone: string): string {
  return dateInTimeZone(new Date(), timeZone);
}

export function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfWeek(dateStr: string, weekStartsOn: 0 | 1 = 1): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=周日
  const diff = (day - weekStartsOn + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function endOfWeek(dateStr: string, weekStartsOn: 0 | 1 = 1): string {
  return addDays(startOfWeek(dateStr, weekStartsOn), 6);
}

export function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

export function endOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m, 0)); // 第 0 天 = 上月最后一天
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function monthGrid(year: number, month1: number, weekStartsOn: 0 | 1 = 1): string[] {
  const first = `${year}-${String(month1).padStart(2, "0")}-01`;
  const gridStart = startOfWeek(first, weekStartsOn);
  const cells: string[] = [];
  for (let i = 0; i < 42; i += 1) cells.push(addDays(gridStart, i));
  return cells;
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end && out.length < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

const CN_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function formatChineseDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const weekday = CN_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y} 年 ${m} 月 ${d} 日 · 周${weekday}`;
}

export function relativeDayLabel(dateStr: string, todayStr: string): string | null {
  if (dateStr === todayStr) return "今天";
  if (dateStr === addDays(todayStr, -1)) return "昨天";
  if (dateStr === addDays(todayStr, -2)) return "前天";
  return null;
}

/** 把「日期 + 本地时分」解释为该用户在某时区的绝对时刻 */
export function combineDateTime(dateStr: string, hhmm: string | null, timeZone: string): Date {
  if (!hhmm) {
    // 未指定时刻：取该日在该时区的 12:00，避免跨时区落到前一天/后一天
    return zonedToUtc(dateStr, "12:00", timeZone);
  }
  return zonedToUtc(dateStr, hhmm, timeZone);
}

function zonedToUtc(dateStr: string, hhmm: string, timeZone: string): Date {
  // 目标：求 UTC 时刻 u，使 u 在 timeZone 的墙钟恰好等于「dateStr hhmm」。
  // 用 Intl.formatToParts 迭代求偏移（两轮收敛，DST 边界也稳）。
  // 注意不能用 toLocaleString + 本地 Date 解析往返：宿主时区恰好等于目标时区时
  // 偏移会被抵消成 0，墙钟被整体当成 UTC（曾在 +8 机器上把 12:00 存成 12:00Z，显示 20:00）。
  const wall = `${dateStr}T${hhmm}:00`;
  const wallMs = Date.parse(`${wall}Z`);
  let u = wallMs;
  for (let i = 0; i < 3; i += 1) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(new Date(u))) parts[p.type] = p.value;
    const asUTC = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    u = wallMs - (asUTC - u);
  }
  return new Date(u);
}

export function guessTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}
