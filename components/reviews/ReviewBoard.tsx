"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api/client";
import { PaperButton, PaperCard } from "@/components/paper/PaperCard";
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

/** 复盘看板。生成是后台任务，未完成时轮询直到状态落定。 */
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
      <section className="paper-noise relative rounded-(--radius-card) bg-paper-card p-3.5 shadow-(--shadow-paper)">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(TYPE_LABEL) as ReviewType[]).map((t) => (
            <PaperButton key={t} variant="primary" disabled={request.isPending} onClick={() => request.mutate(t)}>
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
        <p className="mt-1.5 text-xs text-ink-faint">留空则以今天为锚点 · 时区 {timezone}</p>
      </section>

      {list.isLoading ? (
        <div className="h-28 animate-pulse rounded-(--radius-card) bg-paper-card/70" />
      ) : null}

      {rows.length === 0 && !list.isLoading ? (
        <p className="py-8 text-center text-sm text-ink-muted">还没有复盘。先写几天记录，再点上面的按钮。</p>
      ) : null}

      {rows.map((r) => {
        const c = r.contentJson ?? {};
        const pending = r.status === "pending" || r.status === "running";

        return (
          <PaperCard key={r.id} seed={r.id} tape className="p-4">
            <header className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-(--font-serif-cn) text-base">
                  {TYPE_LABEL[r.type as ReviewType] ?? r.type} · {formatChineseDate(r.startDate)}
                  {r.startDate !== r.endDate ? ` — ${formatChineseDate(r.endDate)}` : ""}
                </h2>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {pending ? "生成中…" : r.status === "failed" ? "生成失败" : `模型 ${r.model || "—"} · v${r.promptVersion}`}
                </p>
              </div>
              <PaperButton variant="ghost" disabled={pending || regenerate.isPending} onClick={() => regenerate.mutate(r.id)}>
                重新生成
              </PaperButton>
            </header>

            {pending ? (
              <div className="scan-line mt-3 h-1 animate-pulse rounded-full" />
            ) : r.status === "failed" ? (
              <p className="mt-2 text-xs text-rose">生成失败：请到「设置 → AI 服务商」检查密钥与模型是否可用。</p>
            ) : (
              <div className="mt-2 space-y-3 text-sm leading-relaxed">
                {c.summary ? <p className="whitespace-pre-wrap">{c.summary}</p> : null}

                {c.themes?.length ? (
                  <div>
                    <h3 className="mb-1 text-xs text-ink-muted">主题</h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {c.themes.map((t) => (
                        <li key={t.name} className="rounded-[3px] bg-sage/15 px-2 py-0.5 text-xs">
                          {t.name} · {t.count}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {c.highlights?.length ? (
                  <div>
                    <h3 className="mb-1 text-xs text-ink-muted">值得记住</h3>
                    <ul className="space-y-1">
                      {c.highlights.map((h, i) => (
                        <li key={i} className="pl-3 text-sm before:mr-1.5 before:content-['·']">
                          {h.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {c.suggestions?.length ? (
                  <div>
                    <h3 className="mb-1 text-xs text-ink-muted">接下来可以</h3>
                    <ul className="space-y-1 text-ink/85">
                      {c.suggestions.map((s, i) => (
                        <li key={i} className="pl-3 text-sm before:mr-1.5 before:content-['→']">
                          {s.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {c.keywords?.length ? (
                  <p className="text-xs text-ink-faint">{c.keywords.map((k) => `#${k}`).join("  ")}</p>
                ) : null}
              </div>
            )}
          </PaperCard>
        );
      })}
    </div>
  );
}
