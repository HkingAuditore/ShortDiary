import { tornClass, HandNote } from "@/components/paper/PaperCard";

/**
 * Tab 切换骨架屏（路由 loading.tsx 统一入口）。
 * 骨架必须和真卡片同构（同一套毛边、同一套投影、同样的内部间距），
 * 否则内容到达时会「跳一下」——那比多等 200ms 更伤。骨架只是少了文字与胶带。
 * 脉冲错峰形成轻微涟漪。
 */
export type TabLoadingVariant = "compose" | "list" | "grid" | "photos" | "panel";

export function TabLoading({ label, variant = "list" }: { label?: string; variant?: TabLoadingVariant }) {
  return (
    <section role="status" aria-busy="true" aria-label={label ? `${label}加载中` : "加载中"} className="space-y-4">
      {label ? (
        <div className="flex items-baseline">
          <h1 className="font-(--font-serif-cn) text-lg text-ink">{label}</h1>
          <HandNote className="ml-2">翻找纸堆中…</HandNote>
        </div>
      ) : (
        <p className="hand-note px-1 text-xs text-ink-muted">翻找纸堆中…</p>
      )}

      {variant === "compose" ? <ComposerSkeleton /> : null}
      {variant === "compose" || variant === "list"
        ? [0, 1, 2].map((i) => <SkeletonCard key={i} seed={i + 11} />)
        : null}
      {variant === "grid" ? <CalendarSkeleton /> : null}
      {variant === "photos" ? <PhotosSkeleton /> : null}
      {variant === "panel" ? <PanelSkeleton /> : null}
    </section>
  );
}

/** 空白纸卡：与 EntryCard 同构（毛边纸张 + 时间行 + 两行正文占位） */
function SkeletonCard({ seed = 0 }: { seed?: number | string }) {
  return (
    <div aria-hidden className={`paper-piece paper-drop ${tornClass(seed)}`} style={{ rotate: `${((Number(seed) % 5) - 2) * 0.28}deg` }}>
      <span aria-hidden className="paper-sheet" />
      <div className="flex items-baseline gap-3 px-4 pt-3.5">
        <div
          className="h-3 w-14 animate-pulse rounded-[2px] bg-ink/10"
          style={{ animationDelay: `${Number(seed) * 90}ms` }}
        />
        <div className="h-3 w-10 animate-pulse rounded-[2px] bg-ink/5" style={{ animationDelay: `${Number(seed) * 90 + 120}ms` }} />
      </div>
      <div className="space-y-2 px-4 pb-4 pt-3">
        <div
          className="h-3 w-[92%] animate-pulse rounded-[2px] bg-ink/10"
          style={{ animationDelay: `${Number(seed) * 90 + 60}ms` }}
        />
        <div
          className="h-3 w-[74%] animate-pulse rounded-[2px] bg-ink/8"
          style={{ animationDelay: `${Number(seed) * 90 + 180}ms` }}
        />
      </div>
    </div>
  );
}

/** 时间线顶部的记录条占位 */
function ComposerSkeleton() {
  return (
    <div aria-hidden className="paper-piece paper-drop deckle-2">
      <span aria-hidden className="paper-sheet" style={{ "--sheet-color": "#fdfaf1" } as React.CSSProperties} />
      <div className="h-24 animate-pulse rounded-[2px] bg-transparent" />
    </div>
  );
}

/** 日历月格：7 列涟漪 */
function CalendarSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-7 gap-1.5">
      {Array.from({ length: 35 }, (_, i) => (
        <div
          key={i}
          className="aspect-square animate-pulse rounded-[3px] bg-paper-strong/70"
          style={{ animationDelay: `${((i % 7) + Math.floor(i / 7) * 2) * 50}ms` }}
        />
      ))}
    </div>
  );
}

/** 拍立得墙：微角度 + 错峰，与 PolaroidPhoto 同构 */
function PhotosSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="polaroid aspect-[4/5] p-[7px]"
          style={{ rotate: `${((i % 5) - 2) * 0.5}deg`, animationDelay: `${i * 70}ms` }}
        />
      ))}
    </div>
  );
}

/** 设置面板：与 SettingsPanel 的纸卡同构 */
function PanelSkeleton() {
  return (
    <div aria-hidden className="paper-piece paper-drop deckle-4">
      <span aria-hidden className="paper-sheet" />
      <div className="space-y-4 px-5 py-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="h-3.5 w-24 animate-pulse rounded bg-ink/10" style={{ animationDelay: `${i * 80}ms` }} />
            <div className="h-8 w-40 animate-pulse rounded bg-ink/5" style={{ animationDelay: `${i * 80 + 100}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
