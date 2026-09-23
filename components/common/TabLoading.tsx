import { tornClass, HandNote } from "@/components/paper/PaperCard";

/**
 * Tab 切换骨架屏（路由 loading.tsx 统一入口）。
 * 材质上刻意比真卡片「素」：无噪点、无胶带，只保留撕边轮廓和缓慢呼吸，
 * 让用户读出「内容在路上」而不是「页面坏了」。脉冲错峰形成轻微涟漪。
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

/** 空白纸卡：撕边 + 呼吸，日期签位置与真实条目一致（§3.10.2） */
function SkeletonCard({ seed = 0 }: { seed?: number }) {
  return (
    <div
      aria-hidden
      className={`paper-drop relative bg-paper-card/90 shadow-(--shadow-paper) ${tornClass(seed)}`}
    >
      <div className="flex items-baseline gap-3 px-4 pt-3.5">
        <div
          className="h-5 w-16 animate-pulse rounded-l-[6px] rounded-r-[3px] bg-ink/10"
          style={{ animationDelay: `${seed * 90}ms` }}
        />
        <div className="h-3 w-10 animate-pulse rounded-[2px] bg-ink/5" style={{ animationDelay: `${seed * 90 + 120}ms` }} />
      </div>
      <div className="space-y-2 px-4 pb-4 pt-3">
        <div
          className="h-3 w-[92%] animate-pulse rounded-[2px] bg-ink/10"
          style={{ animationDelay: `${seed * 90 + 60}ms` }}
        />
        <div
          className="h-3 w-[74%] animate-pulse rounded-[2px] bg-ink/8"
          style={{ animationDelay: `${seed * 90 + 180}ms` }}
        />
      </div>
    </div>
  );
}

/** 时间线顶部的记录条占位 */
function ComposerSkeleton() {
  return (
    <div
      aria-hidden
      className="paper-drop relative h-24 animate-pulse rounded-(--radius-card) bg-paper-strong/80 shadow-(--shadow-paper)"
    />
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

/** 拍立得墙：微角度 + 错峰 */
function PhotosSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="aspect-[4/5] animate-pulse bg-paper-strong/80 p-[6px] shadow-(--shadow-paper) ring-1 ring-ink/10"
          style={{ transform: `rotate(${((i % 5) - 2) * 0.5}deg)`, animationDelay: `${i * 70}ms` }}
        />
      ))}
    </div>
  );
}

/** 设置面板：行式表单 */
function PanelSkeleton() {
  return (
    <div
      aria-hidden
      className="paper-drop space-y-4 bg-paper-card px-5 py-4 shadow-(--shadow-paper)"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <div className="h-3.5 w-24 animate-pulse rounded bg-ink/10" style={{ animationDelay: `${i * 80}ms` }} />
          <div className="h-8 w-40 animate-pulse rounded bg-ink/5" style={{ animationDelay: `${i * 80 + 100}ms` }} />
        </div>
      ))}
    </div>
  );
}
