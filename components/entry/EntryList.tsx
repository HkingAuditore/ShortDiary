"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { EntryCard } from "./EntryCard";
import { WashiTape } from "@/components/paper/PaperCard";
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
      // 估高尽量贴近真实卡片：正文 + AI 附注框 + 标签行 + 图片。
      // 估得越准，未测量行的首帧重叠越轻（measureElement 会在渲染后纠正）。
      let base = 96 + Math.min(row.entry.content.length, 600) * 0.13;
      if (row.entry.ai?.summary) base += 96;
      if (row.entry.tags.length > 0) base += 34;
      const images = row.entry.assets.length > 0 ? 260 : 0;
      return base + images;
    },
    overscan: 6,
    scrollMargin,
    // 按 entry id（而非行号）缓存实测高度：新记录插到列表头部时行号整体平移，
    // 按 index 缓存会让所有行的测量值错位（切页回来排版重叠的直接原因）。
    getItemKey: (i) => rows[i]?.key ?? i,
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
          <div key={i} className="paper-piece deckle-3" style={{ rotate: `${(i - 1) * 0.28}deg` }}>
            <span aria-hidden className="paper-sheet" />
            <div className="h-28 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <p className="paper-piece deckle-1 px-3 py-2 text-sm text-ink">
        <span aria-hidden className="paper-sheet" style={{ "--sheet-color": "#f0d5d0" } as React.CSSProperties} />
        <span className="relative">加载失败：{(query.error as Error).message}</span>
        <button type="button" className="paper-focus relative ml-2 underline" onClick={() => void query.refetch()}>
          重试
        </button>
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-1 py-10 text-center">
        <p className="hand-note text-base text-ink-muted">{emptyHint}</p>
        <p className="mt-2 text-xs text-ink-muted/90">写下的每一个字都会被好好收着</p>
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
              /* 注意：虚拟行的位置靠内联 transform 定位，这里不能再加 transform 动画
                 （CSS 动画优先级高于内联样式，会让整列行塌到 y=0）——只用 opacity 淡入 */
              className="slip-in absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
            >
              {row.kind === "date" ? (
                /* 日期分隔：一张斜贴的索引标签，被一条和纸胶带压住 */
                <h2 className="flex items-center gap-2.5 px-1 pb-2.5 pt-4">
                  <span className="relative inline-flex items-center">
                    <span className="paper-date-tab relative -rotate-[1.4deg] px-2.5 py-1 pr-3.5 font-(--font-serif-cn) text-sm text-ink">
                      {relativeDayLabel(row.date, today) ?? formatChineseDate(row.date)}
                    </span>
                    <WashiTape seed={row.date} className="-left-1 -top-1.5 h-[0.85rem] w-[2.6rem] opacity-70" />
                  </span>
                  {relativeDayLabel(row.date, today) ? (
                    <span className="hand-note text-xs text-ink-muted">{row.date}</span>
                  ) : null}
                  <span aria-hidden className="crayon-rule ml-1 flex-1" />
                </h2>
              ) : (
                /* 密集贴叠：奇数行靠左、偶数行右缩一档 —— 纸上手账本来就是歪的 */
                <div className={["pb-3", item.index % 2 === 0 ? "pr-2.5" : "pl-2.5"].join(" ")}>
                  <EntryCard entry={row.entry} timezone={timezone} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {query.isFetchingNextPage ? (
        <p className="py-4 text-center text-xs text-ink-muted">正在翻更早的纸页…</p>
      ) : null}
      {!query.hasNextPage && rows.length > 0 ? (
        <p className="hand-note py-6 text-center text-xs text-ink-muted">— 已经翻到最开始了 —</p>
      ) : null}
    </div>
  );
}
