"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { EntryCard } from "./EntryCard";
import { useEntries, type EntriesPage, type EntryFilters } from "@/lib/hooks/useEntries";
import { formatChineseDate, relativeDayLabel } from "@/lib/utils/date";
import type { EntryView } from "@/lib/entry/entry.schema";

/**
 * 时间线列表：虚拟滚动 + 游标分页。
 * 只渲染视口附近的卡片，几千条记录下 DOM 节点数恒定。
 */

type Row = { kind: "date"; key: string; date: string } | { kind: "entry"; key: string; entry: EntryView };

function buildRows(entries: EntryView[]): Row[] {
  const rows: Row[] = [];
  let lastDate = "";
  for (const entry of entries) {
    if (entry.entryDate !== lastDate) {
      lastDate = entry.entryDate;
      rows.push({ kind: "date", key: `d:${entry.entryDate}`, date: entry.entryDate });
    }
    rows.push({ kind: "entry", key: entry.id, entry });
  }
  return rows;
}

interface EntryListProps {
  filters?: EntryFilters;
  endpoint?: string;
  timezone: string;
  today: string;
  /** RSC 首屏数据：直接作为第一页注入，避免客户端再请求一次 */
  initialPage?: EntriesPage;
  emptyHint?: string;
}

export function EntryList({
  filters = {},
  endpoint = "/api/entries",
  timezone,
  today,
  initialPage,
  emptyHint = "还没有记录。写下第一条吧。",
}: EntryListProps) {
  const query = useEntries(filters, endpoint, initialPage);

  const entries = useMemo(
    () => (query.data ? query.data.pages.flatMap((p) => p.data) : []),
    [query.data],
  );
  const rows = useMemo(() => buildRows(entries), [entries]);

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const el = listRef.current;
      if (!el) return;
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [rows.length]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => {
      const row = rows[i];
      if (!row) return 200;
      if (row.kind === "date") return 48;
      const base = 120 + Math.min(row.entry.content.length, 600) * 0.11;
      const images = row.entry.assets.length > 0 ? 260 : 0;
      return base + images;
    },
    overscan: 6,
    scrollMargin,
  });

  const items = virtualizer.getVirtualItems();
  const lastIndex = items[items.length - 1]?.index ?? -1;

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // 滚到接近末尾时拉取下一页（游标，非 OFFSET）
  useEffect(() => {
    if (lastIndex < 0) return;
    if (lastIndex >= rows.length - 8 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [lastIndex, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const isInitialLoading = query.isLoading && rows.length === 0;

  if (isInitialLoading) {
    return (
      <div className="space-y-3" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-(--radius-card) bg-paper-card/70" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <p className="rounded-(--radius-card) bg-rose/15 px-3 py-2 text-sm text-ink">
        加载失败：{(query.error as Error).message}
        <button type="button" className="paper-focus ml-2 underline" onClick={() => void query.refetch()}>
          重试
        </button>
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-1 py-10 text-center">
        <p className="hand-note text-base text-ink-muted">{emptyHint}</p>
        <p className="mt-2 text-xs text-ink-faint">写下的每一个字都会被好好收着</p>
      </div>
    );
  }

  return (
    <div ref={listRef}>
      <ol
        className="relative"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
        aria-label="记录列表"
      >
        {items.map((item) => {
          const row = rows[item.index];
          if (!row) return null;

          return (
            <li
              key={row.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
            >
              {row.kind === "date" ? (
                /* 日期分隔：日期标签做成一张斜贴的小纸签 */
                <h2 className="flex items-center gap-2.5 px-1 pb-2 pt-5">
                  <span className="relative inline-block -rotate-1 rounded-l-[6px] rounded-r-[3px] bg-paper-deep px-2.5 py-1 font-(--font-serif-cn) text-sm text-ink shadow-[0_2px_5px_rgba(76,58,39,0.18)]">
                    {relativeDayLabel(row.date, today) ?? formatChineseDate(row.date)}
                  </span>
                  {relativeDayLabel(row.date, today) ? (
                    <span className="hand-note text-xs text-ink-faint">{row.date}</span>
                  ) : null}
                </h2>
              ) : (
                <div className="pb-3.5">
                  <EntryCard entry={row.entry} timezone={timezone} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {query.isFetchingNextPage ? (
        <p className="py-4 text-center text-xs text-ink-faint">正在翻更早的纸页…</p>
      ) : null}
      {!query.hasNextPage && rows.length > 0 ? (
        <p className="hand-note py-6 text-center text-xs text-ink-faint">— 已经翻到最开始了 —</p>
      ) : null}
    </div>
  );
}
