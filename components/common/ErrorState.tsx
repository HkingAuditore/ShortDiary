"use client";

import Link from "next/link";
import { PaperButton, HandNote, tornClass } from "@/components/paper/PaperCard";

/**
 * 出错时的纸片卡片。
 * 生产构建下 Next 会隐去真实错误信息只留 digest，所以这里把 digest 展示出来——
 * 用户报障时它是唯一的线索。文案一律说人话，不抛技术黑话。
 */
export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Next 生产构建给的错误摘要 */
  digest?: string;
  /** 不传则不显示重试按钮 */
  onRetry?: () => void;
  retrying?: boolean;
  homeHref?: string;
  homeLabel?: string;
  seed?: number | string;
}

export function ErrorState({
  title = "这一页没能铺开",
  description = "取数据的时候出了岔子，通常是数据库连接临时抖了一下。你写下的东西都还在，没有丢。",
  digest,
  onRetry,
  retrying = false,
  homeHref = "/timeline",
  homeLabel = "回到时间线",
  seed = 7,
}: ErrorStateProps) {
  return (
    <div className="flex min-h-[58vh] w-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[30rem]">
        <div className={`paper-piece paper-drop ${tornClass(seed)}`} style={{ rotate: "-0.7deg" }}>
          <span aria-hidden className="paper-sheet" />
          <div className="relative px-6 py-7">
            <p className="hand-note text-xs text-ink-muted">纸页被风吹乱了</p>
            <h1 className="mt-2 font-(--font-serif-cn) text-2xl tracking-[0.06em] text-ink">{title}</h1>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">{description}</p>

            {digest ? (
              <p className="mt-3 font-mono text-[11px] text-ink-faint">
                错误编号 <span className="select-all">{digest}</span>
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {onRetry ? (
                <PaperButton variant="primary" onClick={onRetry} disabled={retrying}>
                  {retrying ? "正在重铺纸页…" : "再试一次"}
                </PaperButton>
              ) : null}
              <Link
                href={homeHref}
                className="hand-note text-[13px] text-sage underline decoration-dotted underline-offset-4 transition-colors duration-(--dur-fast) hover:text-ink"
              >
                {homeLabel} →
              </Link>
            </div>
          </div>
        </div>

        <HandNote className="mt-4 block text-center text-xs">多数时候，再试一次就好</HandNote>
      </div>
    </div>
  );
}
