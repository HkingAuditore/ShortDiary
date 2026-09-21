import { clsx } from "clsx";

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
    <div className={clsx("grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]", className)}>
      <div className="min-w-0">{children}</div>
      <aside className="hidden space-y-4 xl:block" aria-label="辅助信息">
        {aside}
      </aside>
    </div>
  );
}

/** 右栏纸片卡：比主卡片更轻，撕边 + 米白，不承载关键操作 */
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
  return (
    <section
      className={clsx(
        "paper-drop relative bg-paper-card px-4 py-3.5 text-ink shadow-(--shadow-paper) transition-[transform,box-shadow] duration-(--dur-fast) ease-out hover:-translate-y-[1px]",
        seed !== undefined && tornClassOf(seed),
        className,
      )}
    >
      <span aria-hidden className="paper-noise pointer-events-none absolute inset-0" />
      <div className="relative">
        {title ? <h2 className="mb-2 font-(--font-serif-cn) text-sm text-ink">{title}</h2> : null}
        {children}
      </div>
    </section>
  );
}

function tornClassOf(seed: number | string): string {
  const n =
    typeof seed === "number" ? seed : Array.from(String(seed)).reduce((a, c) => a + c.charCodeAt(0), 0);
  return `torn-${(n % 4) + 1}`;
}
