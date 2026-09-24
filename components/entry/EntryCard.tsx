"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { apiGet, apiSend } from "@/lib/api/client";
import { isAiFailed, isAiPending } from "@/lib/entry/ai-status";
import { AiPendingNote } from "./AiPendingNote";
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
    /* 照片行做成「散摆在纸上」：负间距让相纸互相压叠，hover 的那张升到最上面 */
    <ul className="mt-3.5 flex flex-wrap items-start gap-x-1 gap-y-3 pl-1">
      {assets.map((a, i) => {
        const placeholder = blurhashToDataUrl(a.blurhash);
        return (
          <li
            key={a.id}
            className={[
              "transition-[transform,z-index] duration-(--dur-normal) ease-(--ease-spring-soft) hover:z-20",
              assets.length === 1 ? "w-full max-w-[17rem]" : "w-[calc(50%-0.35rem)] max-w-[13.5rem]",
              i > 0 ? "-ml-2" : "",
            ].join(" ")}
            style={{ zIndex: assets.length - i }}
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

export function EntryCard({ entry: entryProp, timezone }: EntryCardProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entryProp.content);

  const pendingFromProps = isAiPending(entryProp.aiStatus);

  /**
   * 附注生成中时只轮询这一条。
   * 时间线是游标分页的无限列表，整页 refetch 会随已加载页数放大请求量；
   * 这里也不依赖列表刷新的时机：一旦取回的那份不再是「生成中」，下一轮就不再续期。
   */
  const live = useQuery({
    queryKey: queryKeys.entries.detail(entryProp.id),
    queryFn: () => apiGet<EntryView>(`/api/entries/${entryProp.id}`),
    enabled: pendingFromProps,
    refetchInterval: (query) => {
      const fresh = query.state.data;
      if (fresh && fresh.updatedAt > entryProp.updatedAt && !isAiPending(fresh.aiStatus)) return false;
      return pendingFromProps ? 2_500 : false;
    },
    staleTime: 0,
  });

  // 只采纳服务端更新的一份：轮询期间若用户刚改过内容，别让旧快照把它盖回去
  const entry = live.data && live.data.updatedAt > entryProp.updatedAt ? live.data : entryProp;

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
  // 没有正文就不贴便签：只挂几个主题词的空便签看着像「附注生成了一半」
  const showAi = Boolean(ai?.reaction);
  // pending / queued / running 都算「正在生成」：worker 领走任务后会立刻把状态改成
  // running，只认 pending 的话提示会当场消失，看起来就像卡死了
  const aiPending = isAiPending(entry.aiStatus);
  /** 旧附注还在、内容已经改了：便签角上标一句「正在重写」，别让用户读着旧内容以为没反应 */
  const aiRewriting = aiPending && showAi;

  /** 手动催一次整理：等太久或生成失败时的出口，落成 queued 后界面立刻变回「正在读」 */
  const reannotate = useMutation({
    mutationFn: () => apiSend<{ jobId: string }>(`/api/ai/annotate/${entry.id}`, "POST", {}),
    onSuccess: () => {
      invalidate();
      toast.push("已经重新排上队了，马上就好", { tone: "info" });
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  return (
    <PaperCard
      as="article"
      id={entry.id}
      seed={entry.id}
      hover
      stack={entry.assets.length > 0}
      clip={showAi}
      className={["paper-entry-card scroll-mt-6 px-4 py-3.5", aiPending ? "ai-scanning-wrap" : ""].join(" ")}
    >
      {aiPending ? <span aria-hidden className="ai-scan-layer" /> : null}
      <header className="flex items-start justify-between gap-2">
        <time dateTime={entry.occurredAt} className="hand-note text-[13px] tracking-wide text-ink">
          {timeInTimeZone(entry.occurredAt, timezone)}
        </time>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={entry.starred ? "取消收藏" : "收藏"}
            aria-pressed={entry.starred}
            onClick={() => patch.mutate({ starred: !entry.starred })}
            className={[
              "paper-focus px-1 text-base leading-none transition-transform duration-(--dur-fast) ease-(--ease-spring) hover:scale-125 hover:-rotate-12",
              entry.starred ? "star-pop text-sun drop-shadow-[0_1px_1px_rgba(120,86,20,.35)]" : "text-ink-muted",
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
            className="mt-1.5 whitespace-pre-wrap break-words font-(--font-serif-cn) text-[15.5px] leading-[1.85] tracking-[0.01em]"
          >
            {entry.content}
          </motion.p>
        )}
      </AnimatePresence>

      <EntryImages assets={entry.assets} seedBase={entry.id} />

      {showAi ? (
        /* AI 附注 = 贴在记录下方的一张小便签：底色不同、角度不同，一眼分得清「谁写的」 */
        <div
          className="sticky-note ai-note-in relative mt-3.5 -rotate-[0.6deg] px-3 py-2.5 text-xs leading-relaxed text-ink/90"
          style={{ "--sticky-color": "#e7efe3" } as React.CSSProperties}
        >
          <HandNote className="mr-1.5 text-[13px] text-sage">AI 附注</HandNote>
          {aiRewriting ? (
            <span className="hand-note inline-flex items-center gap-1 text-[11px]">
              正在重写
              <span className="inline-flex items-center gap-0.5 text-sage" aria-hidden>
                <span className="ink-dot-2" />
                <span className="ink-dot-2" />
                <span className="ink-dot-2" />
              </span>
            </span>
          ) : null}
          {ai?.reaction ? <p className="mt-0.5">{ai.reaction}</p> : null}
          {ai?.topics?.length ? (
            <p className="mt-1.5 flex flex-wrap gap-1 text-ink-muted">
              {ai.topics.map((t) => (
                <span key={t} className="rounded-[2px] bg-sage/18 px-1.5 py-0.5">
                  {t}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : aiPending ? (
        /* 生成中占住附注将要出现的位置：纸面扫描 + 一个在走的秒数 */
        <AiPendingNote onRetry={() => reannotate.mutate()} retrying={reannotate.isPending} />
      ) : isAiFailed(entry.aiStatus) ? (
        /* 失败大多数是服务商没配好或模型报错，给一条能自己排查的路 */
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          <span>AI 附注这次没写出来。</span>
          <button
            type="button"
            disabled={reannotate.isPending}
            onClick={() => reannotate.mutate()}
            className="paper-focus underline decoration-dotted underline-offset-2 transition-colors hover:text-ink disabled:opacity-50"
          >
            {reannotate.isPending ? "正在催…" : "再试一次"}
          </button>
          <span aria-hidden className="text-ink-muted/50">
            ·
          </span>
          <a
            href="/settings"
            className="paper-focus underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
          >
            检查 AI 设置
          </a>
        </p>
      ) : null}

      {entry.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
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
