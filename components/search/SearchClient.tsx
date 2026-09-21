"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api/client";
import { EntryList } from "@/components/entry/EntryList";
import { TagChip } from "@/components/paper/PaperCard";

interface TagItem {
  id: string;
  name: string;
  colorToken: string;
  usageCount?: number;
}

/**
 * 搜索回忆：关键词 + 日期区间 + 标签 + 含图 + 星标，条件可任意组合。
 * 关键词走 pg_trgm GIN（不可用时自动退化为 ILIKE）。
 */
export function SearchClient({ timezone, today }: { timezone: string; today: string }) {
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(params.get("q") ?? "");
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [tag, setTag] = useState(params.get("tag") ?? "");
  const [hasImage, setHasImage] = useState(false);
  const [starred, setStarred] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiGet<TagItem[]>("/api/tags"),
    staleTime: 5 * 60_000,
  });

  const filters = { q: debounced || undefined, from: from || undefined, to: to || undefined, tag: tag || undefined, hasImage, starred };

  return (
    <div className="space-y-4">
      <section className="paper-noise relative rounded-(--radius-card) bg-paper-card p-4 shadow-(--shadow-paper)">
        <div className="flex items-center gap-2 border-b border-ink/10 pb-2.5">
          {/* 放大镜用一枚小纸片圆点表达，保持剪纸语言 */}
          <span aria-hidden className="inline-block h-2.5 w-2.5 -rotate-12 rounded-full bg-sage/80 ring-2 ring-sage/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜一句话、一个人名、一个地方……"
            aria-label="搜索关键词"
            className="paper-focus w-full bg-transparent text-[15px] outline-none placeholder:text-ink-faint"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-xs text-ink-muted">
          <label className="flex items-center gap-1">
            从
            <input
              type="date"
              value={from}
              max={today}
              onChange={(e) => setFrom(e.target.value)}
              className="paper-focus rounded-[3px] border border-ink/15 bg-paper-strong px-2 py-1 text-ink"
            />
          </label>
          <label className="flex items-center gap-1">
            到
            <input
              type="date"
              value={to}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              className="paper-focus rounded-[3px] border border-ink/15 bg-paper-strong px-2 py-1 text-ink"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={hasImage}
              onChange={(e) => setHasImage(e.target.checked)}
              className="accent-sage"
            />
            只看带图
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={starred}
              onChange={(e) => setStarred(e.target.checked)}
              className="accent-sun"
            />
            只看收藏
          </label>
          {(from || to || tag || hasImage || starred || q) && (
            <button
              type="button"
              className="paper-focus underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
              onClick={() => {
                setQ("");
                setDebounced("");
                setFrom("");
                setTo("");
                setTag("");
                setHasImage(false);
                setStarred(false);
              }}
            >
              清空条件
            </button>
          )}
        </div>

        {tags.data && tags.data.length > 0 ? (
          <div className="mt-3 border-t border-ink/10 pt-3">
            <div className="flex flex-wrap gap-1.5">
              {tags.data.slice(0, 24).map((t) => (
                <TagChip key={t.id} token={t.colorToken || "sage"} active={tag === t.name} onClick={() => setTag(tag === t.name ? "" : t.name)}>
                  #{t.name}
                </TagChip>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <EntryList
        endpoint="/api/search"
        filters={filters}
        timezone={timezone}
        today={today}
        emptyHint="没有匹配的记录。换个词或放宽条件试试。"
      />
    </div>
  );
}
