"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/lib/api/client";
import { PaperButton, PaperCard, TagChip } from "@/components/paper/PaperCard";
import { useToast } from "@/components/common/Toast";
import { blurhashToDataUrl } from "@/lib/media/placeholder";
import { queryKeys } from "@/lib/query/keys";
import { timeInTimeZone } from "@/lib/utils/date";
import type { EntryAssetView, EntryView } from "@/lib/entry/entry.schema";

/**
 * 单条记录卡片。图片用「宽高比占位 + blurhash 底图」，加载过程不产生跳动（CLS≈0）。
 */

function EntryImages({ assets }: { assets: EntryAssetView[] }) {
  if (assets.length === 0) return null;

  const cols = assets.length === 1 ? 1 : assets.length === 2 || assets.length === 4 ? 2 : 3;

  return (
    <ul
      className="mt-2.5 grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {assets.map((a) => {
        const placeholder = blurhashToDataUrl(a.blurhash);
        return (
          <li key={a.id} className="overflow-hidden rounded-[3px] border border-ink/10 bg-paper-deep/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.url}
              alt={a.alt ?? ""}
              width={a.width}
              height={a.height}
              loading="lazy"
              decoding="async"
              style={{
                aspectRatio: `${a.width} / ${a.height}`,
                backgroundImage: placeholder ? `url(${placeholder})` : undefined,
                backgroundSize: "cover",
              }}
              className="h-auto w-full object-cover"
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
    <PaperCard seed={entry.id} hover className="p-4">
      <header className="flex items-start justify-between gap-2 text-xs text-ink-muted">
        <time dateTime={entry.occurredAt}>{timeInTimeZone(entry.occurredAt, timezone)}</time>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={entry.starred ? "取消收藏" : "收藏"}
            aria-pressed={entry.starred}
            onClick={() => patch.mutate({ starred: !entry.starred })}
            className={["paper-focus px-1 text-base leading-none", entry.starred ? "text-sun" : "text-ink-faint"].join(" ")}
          >
            {entry.starred ? "★" : "☆"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(entry.content);
              setEditing((v) => !v);
            }}
            className="paper-focus px-1 underline decoration-dotted underline-offset-2"
          >
            {editing ? "取消" : "编辑"}
          </button>
          <button
            type="button"
            onClick={() => remove.mutate()}
            className="paper-focus px-1 text-rose/80 underline decoration-dotted underline-offset-2"
          >
            删除
          </button>
        </div>
      </header>

      {editing ? (
        <div className="mt-2">
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
        </div>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{entry.content}</p>
      )}

      <EntryImages assets={entry.assets} />

      {showAi ? (
        <div className="mt-3 rounded-[3px] bg-sage/10 px-2.5 py-2 text-xs leading-relaxed text-ink/85">
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
        <p className="mt-3 text-xs text-ink-faint">AI 整理中…</p>
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
