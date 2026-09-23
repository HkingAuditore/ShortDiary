"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { apiGet, apiSend } from "@/lib/api/client";
import { PaperButton, PaperCard, TagChip, WashiTape } from "@/components/paper/PaperCard";
import { useToast } from "@/components/common/Toast";
import { formatChineseDate } from "@/lib/utils/date";

type ReviewType = "daily" | "weekly" | "monthly";

interface Theme {
  name: string;
  count: number;
  entryIds?: string[];
}

interface ReviewItem {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
  model: string;
  promptVersion: string;
  generatedAt: string | null;
  contentJson: {
    summary?: string;
    themes?: Theme[];
    highlights?: Array<{ text: string; entryIds?: string[] }>;
    suggestions?: Array<{ text: string; basisEntryIds?: string[] }>;
    keywords?: string[];
    milestones?: Array<{ text: string }>;
    trajectory?: Array<{ text: string }>;
    nextMonth?: Array<{ text: string }>;
    energy?: { label: string; confidence: number };
  };
}

const TYPE_LABEL: Record<ReviewType, string> = { daily: "日报", weekly: "周报", monthly: "月报" };
const THEME_TOKENS = ["sage", "sun", "rose", "sky", "ink"];

/** 各 section 依次淡入/轻上浮，每块 100ms stagger（§3.7），最多 4–5 组 */
function ReviewSection({
  title,
  delay,
  children,
}: {
  title: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
        <span aria-hidden className="inline-block h-2 w-2 -rotate-3 rounded-[1px] bg-sage/70" />
        {title}
      </h3>
      {children}
    </motion.div>
  );
}

/** 复盘看板（§3.10.3）：总结 → 主题纸片 → 值得记住 → 接下来可以。
 *  生成是后台任务，未完成时卡片边缘出现柔和扫描线 + 三点墨迹。 */
export function ReviewBoard({ timezone }: { timezone: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [anchor, setAnchor] = useState("");

  const list = useQuery({
    queryKey: ["reviews"],
    queryFn: () => apiGet<ReviewItem[]>("/api/reviews", { limit: 30 }),
    staleTime: 10_000,
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      return rows.some((r) => r.status === "pending" || r.status === "running") ? 4000 : false;
    },
  });

  const request = useMutation({
    mutationFn: (type: ReviewType) =>
      apiSend<{ reviewId: string }>("/api/reviews", "POST", { type, ...(anchor ? { anchor } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reviews"] });
      toast.push("已开始生成，稍等几秒", { tone: "info" });
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  const regenerate = useMutation({
    mutationFn: (id: string) => apiSend<{ reviewId: string }>(`/api/reviews/${id}/regenerate`, "POST", {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reviews"] });
      toast.push("已重新排队", { tone: "info" });
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      {/* 生成区 = 一张便签纸：这只是「下单」，不是复盘本身 */}
      <section className="paper-piece paper-drop deckle-4">
        <span aria-hidden className="paper-sheet" style={{ "--sheet-color": "#fbf6e9" } as React.CSSProperties} />
        <WashiTape seed="review-ctl" className="-top-2.5 left-1/3 h-[1.1rem] w-[4.6rem]" />
        <div className="px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="hand-note mr-1 hidden text-xs sm:inline">选一段时间，让 AI 帮你重新看见它 →</span>
            {(Object.keys(TYPE_LABEL) as ReviewType[]).map((t) => (
              <PaperButton key={t} variant={t === "weekly" ? "primary" : "secondary"} disabled={request.isPending} onClick={() => request.mutate(t)}>
                生成{TYPE_LABEL[t]}
              </PaperButton>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-muted">
              <span>锚点日期</span>
              <input
                type="date"
                value={anchor}
                onChange={(e) => setAnchor(e.target.value)}
                className="paper-focus rounded-[3px] border border-ink/15 bg-paper-strong px-2 py-1 text-ink"
              />
            </label>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">留空则以今天为锚点 · 时区 {timezone}</p>
        </div>
      </section>

      {list.isLoading ? (
        <div className="paper-piece deckle-1">
          <span aria-hidden className="paper-sheet" />
          <div className="h-28" />
        </div>
      ) : null}

      {rows.length === 0 && !list.isLoading ? (
        <div className="py-10 text-center">
          <p className="hand-note text-base text-ink-muted">还没有复盘。先写几天记录，再点上面的按钮。</p>
          <p className="mt-2 text-xs text-ink-muted">复盘不会改动你的任何一行原文</p>
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {rows.map((r) => {
          const c = r.contentJson ?? {};
          const pending = r.status === "pending" || r.status === "running";

          return (
            <motion.div
              key={r.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <PaperCard seed={r.id} tape clip stack={!pending} className={["px-4 py-4", pending ? "ai-scanning-wrap" : ""].join(" ")}>
                {pending ? <span aria-hidden className="ai-scan-layer" /> : null}
                <header className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-(--font-serif-cn) text-base">
                      {TYPE_LABEL[r.type as ReviewType] ?? r.type} · {formatChineseDate(r.startDate)}
                      {r.startDate !== r.endDate ? ` — ${formatChineseDate(r.endDate)}` : ""}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-ink-muted">
                      {pending ? "生成中…" : r.status === "failed" ? "生成失败" : `模型 ${r.model || "—"} · v${r.promptVersion}`}
                    </p>
                  </div>
                  <PaperButton variant="ghost" disabled={pending || regenerate.isPending} onClick={() => regenerate.mutate(r.id)}>
                    重新生成
                  </PaperButton>
                </header>

                {pending ? (
                  <p className="mt-4 flex items-center gap-1 text-xs text-ink-muted">
                    AI 正在翻阅这段日子
                    <span className="ink-dot" />
                    <span className="ink-dot" style={{ animationDelay: "0.2s" }} />
                    <span className="ink-dot" style={{ animationDelay: "0.4s" }} />
                  </p>
                ) : r.status === "failed" ? (
                  <p className="mt-2 text-xs text-rose">生成失败：请到「设置 → AI 服务商」检查密钥与模型是否可用。</p>
                ) : (
                  <div className="mt-3 space-y-3.5 text-sm leading-relaxed">
                    {c.summary ? (
                      <ReviewSection title="概览" delay={0.02}>
                        <p className="whitespace-pre-wrap text-ink/90">{c.summary}</p>
                      </ReviewSection>
                    ) : null}

                    {c.themes?.length ? (
                      <ReviewSection title="反复出现的主题" delay={0.1}>
                        <ul className="flex flex-wrap gap-1.5">
                          {c.themes.map((t, i) => (
                            <li key={t.name}>
                              <TagChip token={THEME_TOKENS[i % THEME_TOKENS.length] ?? "sage"}>
                                {t.name} · {t.count}
                              </TagChip>
                            </li>
                          ))}
                        </ul>
                      </ReviewSection>
                    ) : null}

                    {c.highlights?.length ? (
                      <ReviewSection title="值得记住" delay={0.18}>
                        <ul className="space-y-1.5">
                          {c.highlights.map((h, i) => (
                            <li
                              key={i}
                              className="rounded-l-[5px] border-l-2 border-sun/60 bg-sun/8 py-1 pl-2.5 pr-1 text-sm text-ink/90"
                            >
                              {h.text}
                            </li>
                          ))}
                        </ul>
                      </ReviewSection>
                    ) : null}

                    {c.suggestions?.length ? (
                      <ReviewSection title="接下来可以" delay={0.26}>
                        <ul className="space-y-1.5">
                          {c.suggestions.map((s, i) => (
                            <li
                              key={i}
                              className="rounded-l-[5px] border-l-2 border-sky/60 bg-sky/8 py-1 pl-2.5 pr-1 text-sm text-ink/85"
                            >
                              {s.text}
                            </li>
                          ))}
                        </ul>
                      </ReviewSection>
                    ) : null}

                    {c.keywords?.length ? (
                      <p className="hand-note text-xs text-ink-muted">{c.keywords.map((k) => `#${k}`).join("  ")}</p>
                    ) : null}
                  </div>
                )}
              </PaperCard>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
