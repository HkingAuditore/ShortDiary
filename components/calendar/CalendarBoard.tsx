"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { apiGet } from "@/lib/api/client";
import { daysInMonth, monthGrid, today as todayStr } from "@/lib/utils/date";
import { HandNote, WashiTape } from "@/components/paper/PaperCard";

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

/** 日历热力（§3.3 日历行）：月视图显示记录密度；点的大小反映当天记录数量。
 *  日期格是「贴在牛皮纸上的小纸片」，有记录的日子微微翘起（阴影 + 轻角度）。 */
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
    /* 日历 = 一张方格本内页：格子是真的方格，有记录的日子贴了一张小纸片 */
    <section aria-label="记录日历" className="paper-piece paper-drop deckle-3">
      <span aria-hidden className="paper-sheet" style={{ "--sheet-color": "#fbf6e6" } as React.CSSProperties} />
      <WashiTape seed="calendar-head" className="-top-2.5 left-10 h-[1.15rem] w-[5rem]" />
      <div className="px-4 py-4 md:px-5 md:py-5">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-baseline font-(--font-serif-cn) text-lg">
            {year} 年 {month} 月
            <HandNote className="ml-2 text-xs">回看某一天</HandNote>
          </h1>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="上一个月"
              className="paper-focus rounded-[3px] border border-ink/12 bg-paper-strong px-2.5 py-1 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,.85),0_1px_1px_rgba(74,55,34,.2)] transition-all duration-(--dur-fast) ease-(--ease-spring-soft) hover:-translate-y-[1.5px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,.85),0_3px_5px_-1px_rgba(74,55,34,.24)] active:translate-y-[1px] active:shadow-none"
              onClick={() => shift(-1)}
            >
              ← 上月
            </button>
            <button
              type="button"
              className="paper-focus rounded-[3px] border border-ink/12 bg-paper-strong px-2.5 py-1 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,.85),0_1px_1px_rgba(74,55,34,.2)] transition-all duration-(--dur-fast) ease-(--ease-spring-soft) hover:-translate-y-[1.5px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,.85),0_3px_5px_-1px_rgba(74,55,34,.24)] active:translate-y-[1px] active:shadow-none"
              onClick={() => {
                const [y, m] = current.split("-").map(Number) as [number, number];
                setYear(y);
                setMonth(m);
              }}
            >
              回到本月
            </button>
            <button
              type="button"
              aria-label="下一个月"
              className="paper-focus rounded-[3px] border border-ink/12 bg-paper-strong px-2.5 py-1 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,.85),0_1px_1px_rgba(74,55,34,.2)] transition-all duration-(--dur-fast) ease-(--ease-spring-soft) hover:-translate-y-[1.5px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,.85),0_3px_5px_-1px_rgba(74,55,34,.24)] active:translate-y-[1px] active:shadow-none"
              onClick={() => shift(1)}
            >
              下月 →
            </button>
          </div>
        </header>

        <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-ink-muted">
          {WEEKDAYS.map((w) => (
            <div key={w} className="border-b border-ink/10 py-1">
              {w}
            </div>
          ))}
        </div>

        <div className={clsx("relative mt-1.5 grid grid-cols-7 gap-1.5 transition-opacity duration-(--dur-normal)", isLoading && "opacity-50")}>
          {grid.map((date) => {
            const inMonth = date.slice(0, 7) === key;
            const stat = statMap.get(date);
            const isToday = date === current;
            const day = Number(date.slice(8));
            // 有记录的日子：小纸片轻微翘起的角度（由日期稳定派生，±1.2°）
            const tilt = stat ? (((day % 3) - 1) * 0.6) : 0;

            return (
              <Link
                key={date}
                href={stat ? `/search?from=${date}&to=${date}` : "#"}
                aria-disabled={!stat}
                aria-label={stat ? `${date}，${stat.count} 条记录` : `${date}，无记录`}
                className={clsx(
                  "paper-focus flex aspect-square flex-col items-center justify-center rounded-[2px] border text-xs transition-all duration-(--dur-normal) ease-(--ease-spring-soft)",
                  inMonth
                    ? stat
                      ? "torn-day border-transparent bg-paper-strong hover:-translate-y-[2px]"
                      : "border-ink/8 bg-paper-strong/40"
                    : "border-transparent bg-transparent text-ink-faint/40",
                  isToday && "ring-2 ring-sage/60 ring-offset-1 ring-offset-paper-card",
                  stat ? "hover:bg-paper-strong" : "pointer-events-none",
                )}
                style={tilt !== 0 ? { rotate: `${tilt}deg` } : undefined}
              >
                <span className={clsx(stat ? "font-medium text-ink" : "text-ink-muted")}>{inMonth ? day : ""}</span>
                <span aria-hidden className="mt-1 flex h-1.5 items-center gap-0.5">
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

        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span>
            本月共 <span className="font-medium text-ink">{data?.days.reduce((n, d) => n + d.count, 0) ?? 0}</span> 条记录 · {totalDays} 天
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-sage" /> 文字
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky" /> 有图
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-sun" /> 有星标
          </span>
        </p>
      </div>
    </section>
  );
}
