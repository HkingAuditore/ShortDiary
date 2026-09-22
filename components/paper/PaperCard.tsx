import { clsx } from "clsx";

/**
 * 剪纸组件库（设计文档 §3.6）。
 * 材质只做层级语言：正文永远在高对比米白纸卡上；
 * 胶带、撕边、冲切形状只出现在装饰位，不参与文字对比度。
 */

export type TornVariant = 1 | 2 | 3 | 4;

/** 由种子稳定派生 0–(n-1)：同一元素每次渲染结果一致，避免视觉抖动 */
function seedMod(seed: number | string, n: number): number {
  const v = typeof seed === "number" ? seed : Array.from(String(seed)).reduce((a, c) => a + c.charCodeAt(0), 0);
  return v % n;
}

export function tornClass(seed: number | string): string {
  return `torn-${(seedMod(seed, 4) + 1) as TornVariant}`;
}

/** 图片/照片的随机微角度：最多 ±2°，保证秩序感（§3.6 照片行） */
export function tiltFromSeed(seed: number | string): number {
  return (seedMod(seed, 5) - 2) * 0.5;
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
  id?: string;
}

export function PaperCard({
  children,
  className,
  seed = 0,
  torn = true,
  tape = false,
  hover = false,
  as: Tag = "div",
  id,
}: PaperCardProps) {
  return (
    <Tag
      id={id}
      className={clsx(
        "paper-drop paper-stack relative bg-paper-card text-ink shadow-(--shadow-paper) transition-[transform,box-shadow,filter] duration-(--dur-fast) ease-out",
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

/** 胶带：随机 1 处 + 角度 ≤ 2°，随机值由种子派生，避免每次重渲染抖动 */
export function TapeDecoration({ seed = 0 }: { seed?: number | string }) {
  const left = 12 + seedMod(seed, 64);
  const angle = tiltFromSeed(seed);

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
    // 主按钮像厚纸片/邮票：双层阴影 + 边缘留白模拟纸张厚度
    primary:
      "bg-sage text-paper-strong shadow-(--shadow-paper) ring-1 ring-sage/60 ring-inset hover:brightness-105 active:translate-y-[1px] active:shadow-none",
    secondary:
      "bg-paper-strong text-ink border border-ink/15 shadow-[0_1px_0_rgba(76,58,39,0.12)] hover:border-ink/25 active:translate-y-[1px] active:shadow-none",
    ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-ink/5 active:translate-y-[1px]",
    danger: "bg-rose/90 text-paper-strong shadow-(--shadow-paper) ring-1 ring-rose/50 ring-inset hover:brightness-105 active:translate-y-[1px] active:shadow-none",
  } as const;

  return (
    <button
      {...rest}
      className={clsx(
        "paper-focus inline-flex items-center justify-center gap-1.5 rounded-(--radius-card) px-3.5 py-2 text-sm font-medium transition-all duration-(--dur-fast) disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ───────────────────────── 标签 Chip：彩色纸片冲切 ───────────────────────── */

const CHIP_TOKENS: Record<string, string> = {
  sage: "bg-sage/18 text-sage border-sage/35",
  sun: "bg-sun/22 text-[#8a6415] border-sun/45",
  rose: "bg-rose/22 text-[#9b4f47] border-rose/45",
  sky: "bg-sky/22 text-[#3d6b80] border-sky/45",
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
        // 冲切感：一侧直角一侧圆角 + 细虚线描边模拟裁切痕
        "paper-focus inline-flex h-6 items-center rounded-l-[7px] rounded-r-[3px] border border-dashed px-2 text-xs leading-none transition-all duration-(--dur-fast)",
        base,
        active && "ring-1 ring-ink/45",
        onClick ? "cursor-pointer hover:-translate-y-[1px] hover:shadow-[0_2px_6px_rgba(76,58,39,0.18)]" : "cursor-default",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ───────────────────────── 拍立得照片：相纸白边 + 胶带，角度 ≤ 2° ───────────────────────── */

export function PolaroidPhoto({
  src,
  alt,
  width,
  height,
  placeholder,
  caption,
  seed = 0,
  className,
  children,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  placeholder?: string | null;
  caption?: string;
  seed?: number | string;
  className?: string;
  /** 覆盖右上角（如删除按钮），自动定位在白边之外 */
  children?: React.ReactNode;
}) {
  const tilt = tiltFromSeed(seed);
  const tapeLeft = 10 + seedMod(seed, 55);

  return (
    <figure
      className={clsx(
        "photo-settle relative bg-paper-strong p-[6px] pb-0 shadow-(--shadow-paper) ring-1 ring-ink/10 transition-[transform,box-shadow] duration-(--dur-fast) ease-out hover:z-10 hover:-translate-y-[2px] hover:rotate-0 hover:shadow-(--shadow-paper-hover)",
        className,
      )}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <span
        aria-hidden
        className="tape absolute -top-2.5 h-4 w-12 rounded-[1px]"
        style={{ left: `${tapeLeft}%`, transform: `rotate(${tilt * -1.5}deg)` }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        style={{
          aspectRatio: `${width} / ${height}`,
          backgroundImage: placeholder ? `url(${placeholder})` : undefined,
          backgroundSize: "cover",
        }}
        className="h-auto w-full select-none object-cover"
      />
      {caption ? (
        <figcaption className="hand-note truncate px-1 py-1.5 text-center text-[11px] leading-tight">{caption}</figcaption>
      ) : (
        <div aria-hidden className="h-3" />
      )}
      {children}
    </figure>
  );
}

/* ───────────────────────── 手写批注（§3.5）：只承载 2–12 字的情绪点缀 ───────────────────────── */

export function HandNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={clsx("hand-note text-xs", className)}>{children}</span>;
}
