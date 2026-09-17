import { clsx } from "clsx";

/**
 * 米白撕边纸卡：承载正文、表单与复盘卡片，必须保证高可读性。
 * 纹理只做层级，不参与文字对比度；撕边用预生成的 4 种变体循环。
 */

export type TornVariant = 1 | 2 | 3 | 4;

export function tornClass(seed: number | string): string {
  const n = typeof seed === "number" ? seed : Array.from(String(seed)).reduce((a, c) => a + c.charCodeAt(0), 0);
  return `torn-${(n % 4) + 1}`;
}

interface PaperCardProps {
  children: React.ReactNode;
  className?: string;
  /** 撕边变体种子：由 id 派生，保证同一卡片每次渲染一致 */
  seed?: number | string;
  torn?: boolean;
  tape?: boolean;
  hover?: boolean;
  as?: "div" | "article" | "section" | "li";
}

export function PaperCard({
  children,
  className,
  seed = 0,
  torn = true,
  tape = false,
  hover = false,
  as: Tag = "div",
}: PaperCardProps) {
  return (
    <Tag
      className={clsx(
        "relative bg-paper-card text-ink shadow-(--shadow-paper) transition-[transform,box-shadow] duration-150 ease-out",
        torn && tornClass(seed),
        hover && "hover:-translate-y-[2px] hover:shadow-(--shadow-paper-hover)",
        className,
      )}
    >
      <span aria-hidden className="paper-noise pointer-events-none absolute inset-0" />
      {tape ? <TapeDecoration seed={seed} /> : null}
      <div className="relative">{children}</div>
    </Tag>
  );
}

/** 胶带：随机 1 处 + 角度 ≤ 2°，随机值在渲染前算好并 memo，避免每次重渲染抖动 */
export function TapeDecoration({ seed = 0 }: { seed?: number | string }) {
  const n = typeof seed === "number" ? seed : Array.from(String(seed)).reduce((a, c) => a + c.charCodeAt(0), 0);
  const left = 12 + (n % 64);
  const angle = ((n % 5) - 2) * 0.5;

  return (
    <span
      aria-hidden
      className="tape absolute -top-2 rounded-[1px] px-3 py-[3px] text-[10px] tracking-wide text-ink/50"
      style={{ left: `${left}%`, transform: `rotate(${angle}deg)` }}
    />
  );
}

export function PaperButton({
  children,
  variant = "secondary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const variants = {
    primary: "bg-sage text-paper-strong shadow-(--shadow-paper) hover:brightness-105 active:translate-y-[1px]",
    secondary: "bg-paper-strong text-ink border border-ink/10 hover:bg-white active:translate-y-[1px]",
    ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-ink/5",
    danger: "bg-rose/85 text-paper-strong hover:brightness-105 active:translate-y-[1px]",
  } as const;

  return (
    <button
      {...rest}
      className={clsx(
        "paper-focus inline-flex items-center justify-center gap-1.5 rounded-(--radius-card) px-3.5 py-2 text-sm font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

const CHIP_TOKENS: Record<string, string> = {
  sage: "bg-sage/18 text-sage border-sage/30",
  sun: "bg-sun/20 text-[#8a6415] border-sun/40",
  rose: "bg-rose/20 text-[#9b4f47] border-rose/40",
  sky: "bg-sky/20 text-[#3d6b80] border-sky/40",
  ink: "bg-ink/10 text-ink border-ink/25",
};

export function TagChip({
  children,
  token = "sage",
  className,
  onClick,
  active,
}: {
  children: React.ReactNode;
  token?: string;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const base = CHIP_TOKENS[token] ?? CHIP_TOKENS.sage!;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "paper-focus inline-flex h-6 items-center rounded-[3px] border px-2 text-xs leading-none transition-colors",
        base,
        active && "ring-1 ring-ink/40",
        onClick ? "cursor-pointer hover:brightness-95" : "cursor-default",
        className,
      )}
    >
      {children}
    </button>
  );
}
