"use client";

import { useEffect, useState } from "react";
import { HandNote } from "@/components/paper/PaperCard";

/**
 * 「AI 附注生成中」的占位便签（§3.6）。
 *
 * 生成一条附注要 5–30 秒，之前的提示是卡片底部一行 12px 的灰字，而且只认
 * ai_status=pending —— worker 一领走任务就把状态改成 running，提示整行消失，
 * 用户对着完全静止的卡片只能以为程序卡死了。
 *
 * 这里让它占住「附注将要出现」的那个位置：同一张便签纸的骨架、纸面扫描光、
 * 一个在走的秒数。秒数是最关键的 —— 别的动效都可能是错觉，数字在涨就是它在干活。
 */

/** 超过这个秒数就承认「有点慢」，给用户一个手动催办的出口 */
const SLOW_SECONDS = 20;

export function AiPendingNote({ onRetry, retrying = false }: { onRetry: () => void; retrying?: boolean }) {
  const [seconds, setSeconds] = useState(0);

  // 从挂载起计时。不用 entry.updatedAt 当起点：worker 领任务时会把 updated_at
  // 刷成 running 时刻，秒数会当着用户的面往回跳。
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="sticky-note ai-note-in relative mt-3.5 -rotate-[0.6deg] px-3 py-2.5 text-xs leading-relaxed text-ink/90"
      style={{ "--sticky-color": "#e7efe3" } as React.CSSProperties}
      role="status"
      aria-live="polite"
    >
      {/* 纸面被来回扫过：和卡片边缘的扫描层同一套动效，说明「正在被处理」 */}
      <span aria-hidden className="ai-scan-layer" />

      <p className="relative flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <HandNote className="text-[13px] text-sage">AI 附注</HandNote>
        <span className="text-ink-muted">正在读这条记录</span>
        <span className="inline-flex items-center gap-0.5 text-sage" aria-hidden>
          <span className="ink-dot-2" />
          <span className="ink-dot-2" />
          <span className="ink-dot-2" />
        </span>
        <span className="ml-auto tabular-nums text-ink-muted/80" aria-hidden>
          {seconds}s
        </span>
      </p>

      {seconds >= SLOW_SECONDS ? (
        <p className="relative mt-1.5 flex items-center gap-2 text-ink-muted">
          <span className="hand-note">比平时久了些……</span>
          <button
            type="button"
            disabled={retrying}
            onClick={onRetry}
            className="paper-focus underline decoration-dotted underline-offset-2 transition-colors hover:text-ink disabled:opacity-50"
          >
            {retrying ? "正在催…" : "再催一次"}
          </button>
        </p>
      ) : null}
    </div>
  );
}
