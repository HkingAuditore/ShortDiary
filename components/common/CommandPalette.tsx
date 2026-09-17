"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api/client";
import type { EntryView } from "@/lib/entry/entry.schema";

const PAGES = [
  { href: "/timeline", label: "时间线", hint: "今天写了什么" },
  { href: "/calendar", label: "日历", hint: "按天回看" },
  { href: "/photos", label: "相册", hint: "所有照片" },
  { href: "/reviews", label: "AI 复盘", hint: "周报 / 月报" },
  { href: "/search", label: "搜索回忆", hint: "关键词 + 筛选" },
  { href: "/settings", label: "设置", hint: "账户 / AI / 数据" },
];

/** 命令面板：⌘K / Ctrl+K。既是跳转入口，也是全文检索入口。 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const term = q.trim();

  const results = useQuery({
    queryKey: ["command-search", term],
    enabled: open && term.length > 0,
    queryFn: () => apiGet<EntryView[]>("/api/search", { q: term, limit: 8 }),
    staleTime: 30_000,
  });

  const pages = useMemo(
    () => (term ? PAGES.filter((p) => p.label.includes(term) || p.hint.includes(term)) : PAGES),
    [term],
  );

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/30" />
        <Dialog.Content className="paper-noise fixed left-1/2 top-[12vh] z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-(--radius-card) bg-paper-card p-3 shadow-(--shadow-paper-hover)">
          <Dialog.Title className="sr-only">命令面板</Dialog.Title>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="跳转，或搜索记录……"
            className="w-full bg-transparent px-1 py-1.5 text-[15px] outline-none placeholder:text-ink-faint"
          />

          <div className="mt-2 max-h-[52vh] overflow-y-auto">
            {term ? (
              <section className="mb-2">
                <h3 className="px-1 pb-1 text-[11px] text-ink-faint">匹配的记录</h3>
                {results.isLoading ? (
                  <p className="px-1 py-2 text-xs text-ink-faint">搜索中…</p>
                ) : (results.data ?? []).length === 0 ? (
                  <p className="px-1 py-2 text-xs text-ink-faint">没有匹配</p>
                ) : (
                  <ul>
                    {(results.data ?? []).map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => go(`/timeline#${e.id}`)}
                          className="paper-focus block w-full truncate rounded-[3px] px-2 py-1.5 text-left text-sm hover:bg-paper-strong"
                        >
                          <span className="mr-2 text-[11px] text-ink-faint">{e.entryDate}</span>
                          {e.content.slice(0, 60)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => go(`/search?q=${encodeURIComponent(term)}`)}
                  className="paper-focus mt-1 block w-full rounded-[3px] px-2 py-1.5 text-left text-xs text-ink-muted hover:bg-paper-strong"
                >
                  在搜索页查看全部结果 →
                </button>
              </section>
            ) : null}

            <section>
              <h3 className="px-1 pb-1 text-[11px] text-ink-faint">跳转</h3>
              <ul>
                {pages.map((p) => (
                  <li key={p.href}>
                    <button
                      type="button"
                      onClick={() => go(p.href)}
                      className="paper-focus flex w-full items-baseline justify-between rounded-[3px] px-2 py-1.5 text-left text-sm hover:bg-paper-strong"
                    >
                      <span>{p.label}</span>
                      <span className="text-[11px] text-ink-faint">{p.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
