import { clsx } from "clsx";
import { PaperClip } from "@/components/paper/PaperCard";

/**
 * 页面双栏骨架（§3.3）：桌面端「主内容 760–900px + 右侧辅助栏 280–340px」。
 * 移动端右栏内容自动下沉到主列下方 —— 由调用方按优先级排列 children。
 */

export function PageShell({
  children,
  aside,
  className,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  if (!aside) {
    return <div className={clsx("mx-auto w-full max-w-3xl", className)}>{children}</div>;
  }

  return (
    <div className={clsx("grid grid-cols-1 items-start gap-7 xl:grid-cols-[minmax(0,1fr)_300px]", className)}>
      <div className="min-w-0">{children}</div>
      <aside className="hidden space-y-5 xl:block" aria-label="辅助信息">
        {aside}
      </aside>
    </div>
  );
}

/** 右栏纸片卡：比主卡片更轻，毛边 + 米白，不承载关键操作；
 *  用小号回形针夹住上沿，与主列的胶带区分开（同一屏不出现两种同款贴法）。 */
export function AsideCard({
  title,
  children,
  seed,
  className,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  seed?: number | string;
  className?: string;
}) {
  // title 可能是 ReactNode，不能直接当种子：只有字符串才拿来做种子兜底
  const s = seed ?? (typeof title === "string" ? title : "aside-card");
  return (
    <section
      className={clsx(
        "paper-piece paper-drop washi-press text-ink",
        tornClassOf(s),
        className,
      )}
    >
      <span aria-hidden className="paper-sheet" />
      <PaperClip seed={s} className="-top-2.5 right-5 h-[2.6rem] w-[1rem]" />
      <div className="px-4 py-3.5">
        {title ? (
          <h2 className="mb-2 flex items-baseline gap-1.5 font-(--font-serif-cn) text-sm text-ink">
            {title}
            <span aria-hidden className="crayon-rule h-[1.5px] flex-1" />
          </h2>
        ) : null}
        {children}
      </div>
    </section>
  );
}

function tornClassOf(seed: number | string): string {
  const n =
    typeof seed === "number" ? seed : Array.from(String(seed)).reduce((a, c) => a + c.charCodeAt(0), 0);
  return `deckle-${(n % 4) + 1}`;
}
