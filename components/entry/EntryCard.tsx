"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { apiSend } from "@/lib/api/client";
import { PaperButton, PaperCard, TagChip, PolaroidPhoto, HandNote } from "@/components/paper/PaperCard";
import { useToast } from "@/components/common/Toast";
import { blurhashToDataUrl } from "@/lib/media/placeholder";
import { queryKeys } from "@/lib/query/keys";
import { timeInTimeZone } from "@/lib/utils/date";
import type { EntryAssetView, EntryView } from "@/lib/entry/entry.schema";

/**
 * 单条记录卡片（§3.6 Entry 卡片行）：
 * 米白撕边纸 + 轻微厚度阴影；图片拍立得化（角度 ≤ 2°，同一张每次一致）。
 * 图片用「宽高比占位 + blurhash 底图」，加载过程不产生跳动（CLS≈0）。
 */

function EntryImages({ assets, seedBase }: { assets: EntryAssetView[]; seedBase: string }) {
  if (assets.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-wrap gap-3">
      {assets.map((a, i) => {
        const placeholder = blurhashToDataUrl(a.blurhash);
        return (
          <li
            key={a.id}
            className={assets.length === 1 ? "w-full max-w-xs" : "w-[calc(50%-0.5rem)] max-w-[220px]"}
          >
            <PolaroidPhoto
              src={a.url}
              alt={a.alt ?? ""}
              width={a.width}
              height={a.height}
              placeholder={placeholder}
              seed={`${seedBase}-${i}`}
            />
          </li>
        );
      })}
    </ul>
  );
}

interface EntryCardProps {
  entry: EntryView;
  timezone: string;
}

export function EntryCard({ entry, timezone }: EntryCardProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.entries.all });
    void qc.invalidateQueries({ queryKey: queryKeys.tags.all });
  };

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiSend<EntryView>(`/api/entries/${entry.id}`, "PATCH", body),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  const remove = useMutation({
    mutationFn: () => apiSend<{ ok: boolean }>(`/api/entries/${entry.id}`, "DELETE"),
    onSuccess: () => {
      invalidate();
      toast.push("已移到废纸篓", {
        tone: "info",
        action: {
          label: "撤销",
          onClick: () => {
            void apiSend<{ ok: boolean }>(`/api/entries/${entry.id}/restore`, "POST", {}).then(
              () => {
                invalidate();
                toast.push("已恢复", { tone: "success" });
              },
              (err: Error) => toast.push(err.message, { tone: "error" }),
            );
          },
        },
      });
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  const ai = entry.ai;
  const showAi = Boolean(ai && (ai.summary || (ai.topics?.length ?? 0) > 0));

  return (
    <PaperCard
      as="article"
      id={entry.id}
      seed={entry.id}
      hover
      className={["scroll-mt-6 p-4", entry.aiStatus === "pending" ? "ai-scanning" : ""].join(" ")}
    >
      <header className="flex items-start justify-between gap-2">
        <time dateTime={entry.occurredAt} className="hand-note text-xs">
          {timeInTimeZone(entry.occurredAt, timezone)}
        </time>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={entry.starred ? "取消收藏" : "收藏"}
            aria-pressed={entry.starred}
            onClick={() => patch.mutate({ starred: !entry.starred })}
            className={[
              "paper-focus px-1 text-base leading-none transition-transform duration-(--dur-fast) hover:scale-110",
              entry.starred ? "text-sun" : "text-ink-faint",
            ].join(" ")}
          >
            {entry.starred ? "★" : "☆"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(entry.content);
              setEditing((v) => !v);
            }}
            className="paper-focus px-1 text-xs text-ink-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
          >
            {editing ? "取消" : "编辑"}
          </button>
          <button
            type="button"
            onClick={() => remove.mutate()}
            className="paper-focus px-1 text-xs text-rose/80 underline decoration-dotted underline-offset-2 transition-colors hover:text-rose"
          >
            删除
          </button>
        </div>
      </header>

      <AnimatePresence initial={false} mode="wait">
        {editing ? (
          <motion.div
            key="editing"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-2"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              maxLength={20000}
              aria-label="编辑正文"
              className="paper-focus w-full resize-y rounded-[3px] border border-ink/15 bg-paper-strong p-2 text-[15px] leading-relaxed text-ink outline-none"
            />
            <div className="mt-2 flex justify-end gap-2">
              <PaperButton variant="primary" disabled={patch.isPending || !draft.trim()} onClick={() => patch.mutate({ content: draft.trim() })}>
                {patch.isPending ? "保存中…" : "保存"}
              </PaperButton>
            </div>
          </motion.div>
        ) : (
          <motion.p
            key="view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed"
          >
            {entry.content}
          </motion.p>
        )}
      </AnimatePresence>

      <EntryImages assets={entry.assets} seedBase={entry.id} />

      {showAi ? (
        <div className="mt-3 rounded-l-[6px] rounded-r-[2px] border-l-2 border-sage/50 bg-sage/8 px-2.5 py-2 text-xs leading-relaxed text-ink/85">
          <HandNote className="mr-1.5 text-sage">AI 附注</HandNote>
          {ai?.summary ? <p>{ai.summary}</p> : null}
          {ai?.topics?.length ? (
            <p className="mt-1 flex flex-wrap gap-1 text-ink-muted">
              {ai.topics.map((t) => (
                <span key={t} className="rounded-[2px] bg-sage/15 px-1.5 py-0.5">
                  {t}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : entry.aiStatus === "pending" ? (
        <p className="mt-3 flex items-center gap-1 text-xs text-ink-faint">
          AI 整理中
          <span className="ink-dot" />
          <span className="ink-dot" style={{ animationDelay: "0.2s" }} />
          <span className="ink-dot" style={{ animationDelay: "0.4s" }} />
        </p>
      ) : null}

      {entry.tags.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {entry.tags.map((t) => (
            <TagChip key={t.id} token={t.colorToken || "sage"}>
              #{t.name}
            </TagChip>
          ))}
        </div>
      ) : null}
    </PaperCard>
  );
}
