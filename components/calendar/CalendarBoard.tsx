"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { apiGet } from "@/lib/api/client";
import { daysInMonth, monthGrid, today as todayStr } from "@/lib/utils/date";

interface DayStat {
  entryDate: string;
  count: number;
  imageCount: number;
  starred: boolean;
}

interface CalendarResponse {
  month: string;
  days: DayStat[];
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** 日历热力：一次聚合整月，点的大小反映当天记录数量 */
export function CalendarBoard({ initialYear, initialMonth, timezone }: { initialYear: number; initialMonth: number; timezone: string }) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);

  const key = `${year}-${String(month).padStart(2, "0")}`;

  const { data, isLoading } = useQuery({
    queryKey: ["calendar", year, month],
    queryFn: () => apiGet<CalendarResponse>("/api/calendar", { year, month }),
    staleTime: 60_000,
  });

  const grid = useMemo(() => monthGrid(year, month, 1), [year, month]);
  const statMap = useMemo(() => {
    const m = new Map<string, DayStat>();
    for (const d of data?.days ?? []) m.set(d.entryDate, d);
    return m;
  }, [data]);

  const shift = (delta: number) => {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth() + 1);
  };

  const current = todayStr(timezone);
  const totalDays = daysInMonth(year, month);

  return (
    <section aria-label="记录日历">
      <header className="mb-3 flex items-center justify-between">
        <h1 className="font-(--font-serif-cn) text-lg">
          {year} 年 {month} 月
        </h1>
        <div className="flex items-center gap-1.5">
          <button type="button" className="paper-focus rounded-[3px] border border-ink/15 bg-paper-strong px-2 py-1 text-xs" onClick={() => shift(-1)}>
            上月
          </button>
          <button
            type="button"
            className="paper-focus rounded-[3px] border border-ink/15 bg-paper-strong px-2 py-1 text-xs"
            onClick={() => {
              const [y, m] = current.split("-").map(Number) as [number, number];
              setYear(y);
              setMonth(m);
            }}
          >
            回到本月
          </button>
          <button type="button" className="paper-focus rounded-[3px] border border-ink/15 bg-paper-strong px-2 py-1 text-xs" onClick={() => shift(1)}>
            下月
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-faint">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div className={clsx("grid grid-cols-7 gap-1", isLoading && "opacity-60")}>
        {grid.map((date) => {
          const inMonth = date.slice(0, 7) === key;
          const stat = statMap.get(date);
          const isToday = date === current;
          const day = Number(date.slice(8));

          return (
            <Link
              key={date}
              href={stat ? `/search?from=${date}&to=${date}` : "#"}
              aria-disabled={!stat}
              className={clsx(
                "paper-focus flex aspect-square flex-col items-center justify-center rounded-[3px] border text-xs transition-colors",
                inMonth ? "border-ink/10 bg-paper-card" : "border-transparent bg-transparent text-ink-faint/50",
                isToday && "ring-1 ring-sage",
                stat ? "hover:bg-paper-strong" : "pointer-events-none",
              )}
            >
              <span className={clsx(stat ? "text-ink" : "text-ink-faint")}>{inMonth ? day : ""}</span>
              <span aria-hidden className="mt-0.5 flex h-1.5 items-center gap-0.5">
                {stat
                  ? Array.from({ length: Math.min(stat.count, 4) }).map((_, i) => (
                      <span
                        key={i}
                        className={clsx("inline-block rounded-full", stat.starred ? "bg-sun" : stat.imageCount > 0 ? "bg-sky" : "bg-sage")}
                        style={{ width: 4, height: 4 }}
                      />
                    ))
                  : null}
              </span>
            </Link>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-ink-muted">
        本月共 {data?.days.reduce((n, d) => n + d.count, 0) ?? 0} 条记录 · {totalDays} 天
        {timezone ? ` · 时区 ${timezone}` : ""}
      </p>
    </section>
  );
}
