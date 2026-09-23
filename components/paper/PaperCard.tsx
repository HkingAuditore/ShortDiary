import { clsx } from "clsx";

/**
 * 剪纸组件库（设计文档 §3.6）。
 *
 * 纸片的三层结构（不要合并，合并就回到「有颜色的方块」）：
 *   ① .paper-piece  容器 —— 不带遮罩，装饰可以溢出到纸外（胶带、回形针必须压在纸沿上）；
 *   ② .paper-sheet  纸   —— 唯一吃毛边遮罩的一层，负责纤维、受光、三段投影；
 *   ③ 内容层         —— 正文，永远在纸面之上，不参与任何 filter。
 *
 * 旧实现把 clip-path 直接打在卡片上，导致 ① 胶带被裁掉 ② 阴影是矩形 ③ 纸没有厚度。
 */

export type TornVariant = 1 | 2 | 3 | 4;

/** 由种子稳定派生 0–(n-1)：同一元素每次渲染结果一致，避免视觉抖动 */
function seedMod(seed: number | string, n: number): number {
  const v = typeof seed === "number" ? seed : Array.from(String(seed)).reduce((a, c) => a + c.charCodeAt(0), 0);
  return v % n;
}

export function tornClass(seed: number | string): string {
  return `deckle-${(seedMod(seed, 4) + 1) as TornVariant}`;
}

/** 图片/照片的随机微角度：最多 ±2°，保证秩序感（§3.6 照片行） */
export function tiltFromSeed(seed: number | string): number {
  return (seedMod(seed, 5) - 2) * 0.5;
}

/* ───────────────────────── 拼贴五金件 ───────────────────────── */

const WASHI_TOKENS = ["washi-sun", "washi-sage", "washi-rose", "washi-sky", "washi-kraft"] as const;

/**
 * 和纸胶带：半透明、multiply 压在纸上，两端撕口。
 * 默认贴在纸的上沿并跨出纸外 —— 「跨出去」才是胶带，贴在纸里面那叫色块。
 */
export function WashiTape({
  seed = 0,
  className,
  style,
  token,
  grid,
}: {
  seed?: number | string;
  className?: string;
  style?: React.CSSProperties;
  token?: string;
  grid?: boolean;
}) {
  const tint = token ?? WASHI_TOKENS[seedMod(seed, WASHI_TOKENS.length)]!;
  const angle = (seedMod(`${seed}-a`, 9) - 4) * 0.9;

  return (
    <span
      aria-hidden
      className={clsx("washi", tint, grid && "washi-grid", className)}
      // 用 rotate 属性而非 transform：tape-stick 动画占用 transform，两者才能叠加
      style={{ rotate: `${angle}deg`, ...style }}
    />
  );
}

/** 回形针：金属线弯成的夹子，夹住纸的上沿（一半在纸外） */
export function PaperClip({ seed = 0, className }: { seed?: number | string; className?: string }) {
  const angle = (seedMod(`${seed}-c`, 7) - 3) * 2.2;

  return (
    <svg
      aria-hidden
      viewBox="0 0 26 62"
      className={clsx("clip-metal", className)}
      style={{ transform: `rotate(${angle}deg)` }}
    >
      <defs>
        <linearGradient id={`clip-${seedMod(seed, 4)}`} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0%" stopColor="#f2f0ea" />
          <stop offset="28%" stopColor="#b9b4a8" />
          <stop offset="52%" stopColor="#8f8a7e" />
          <stop offset="74%" stopColor="#cfcabd" />
          <stop offset="100%" stopColor="#7e796d" />
        </linearGradient>
      </defs>
      {/* 外圈 → 折回 → 内圈：一根线画到底，转折处圆角 */}
      <path
        d="M7 56 L7 14 A6.2 6.2 0 0 1 19.4 14 L19.4 48 A4.2 4.2 0 0 1 11 48 L11 20"
        fill="none"
        stroke={`url(#clip-${seedMod(seed, 4)})`}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 订书钉：左上角两颗，压出金属凹痕 */
export function Staples({ seed = 0 }: { seed?: number | string }) {
  const a = (seedMod(`${seed}-s`, 5) - 2) * 3;

  return (
    <>
      <span aria-hidden className="staple" style={{ left: "0.85rem", top: "0.7rem", transform: `rotate(${a}deg)` }} />
      <span
        aria-hidden
        className="staple"
        style={{ left: "0.85rem", top: "1.05rem", transform: `rotate(${a * -0.6}deg)` }}
      />
    </>
  );
}

/** 咖啡渍：偶尔出现在卡片一角的生活痕迹（由种子决定出不出现） */
export function CoffeeRing({ seed = 0 }: { seed?: number | string }) {
  const size = 3.4 + seedMod(`${seed}-r`, 5) * 0.4;
  const right = 4 + seedMod(`${seed}-x`, 30);
  const bottom = -0.6 + seedMod(`${seed}-y`, 4) * 0.5;

  return (
    <span
      aria-hidden
      className="coffee-ring"
      style={{ width: `${size}rem`, height: `${size}rem`, right: `${right}%`, bottom: `${bottom}rem` }}
    />
  );
}

/* ───────────────────────── 纸片卡 ───────────────────────── */

interface PaperCardProps {
  children: React.ReactNode;
  className?: string;
  /** 毛边变体种子：由 id 派生，保证同一卡片每次渲染一致 */
  seed?: number | string;
  torn?: boolean;
  tape?: boolean;
  hover?: boolean;
  /** 纸叠厚度：底下垫 1–2 张错位的纸 */
  stack?: boolean;
  /** 回形针 / 订书钉 / 咖啡渍：由种子决定是否出现，避免每张卡都一样 */
  clip?: boolean;
  /** 纸的底色，默认米白；便签等可以覆盖 */
  sheetColor?: string;
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
  stack = false,
  clip = false,
  sheetColor,
  as: Tag = "div",
  id,
}: PaperCardProps) {
  // 每张纸有自己的落点角度（±0.55°）：整列纸片才不会像表格
  const tilt = (seedMod(`${seed}-t`, 5) - 2) * 0.28;
  const tapeLeft = 8 + seedMod(`${seed}-tl`, 62);
  // 咖啡渍出现概率约 1/7：太频繁就成图案了
  const showStain = seedMod(`${seed}-st`, 7) === 0;

  return (
    <Tag
      id={id}
      data-lift={hover ? "true" : undefined}
      className={clsx(
        "paper-piece washi-press paste-down text-ink",
        torn && tornClass(seed),
        hover && "transition-transform duration-(--dur-normal) ease-(--ease-spring-soft) hover:-translate-y-[3px]",
        className,
      )}
      // rotate 独立属性：不与 transform（入场动画 / hover 位移）互相覆盖
      style={{ rotate: `${tilt}deg` }}
    >
      {/* 纸：毛边 + 纤维 + 受光 + 投影 */}
      <span
        aria-hidden
        className="paper-sheet"
        style={sheetColor ? ({ "--sheet-color": sheetColor } as React.CSSProperties) : undefined}
      />
      {/* 垫纸：纸叠厚度（两张错位的旧纸，压在真纸下面） */}
      {stack ? (
        <>
          <span aria-hidden className="paper-under" style={{ transform: "rotate(-0.9deg) translate(-5px, 4px)" }} />
          <span
            aria-hidden
            className="paper-under is-far"
            style={{ transform: "rotate(0.75deg) translate(6px, -2px)" }}
          />
        </>
      ) : null}

      {tape ? (
        <WashiTape
          seed={seed}
          className="tape-stick -top-2.5 h-[1.15rem] w-[4.6rem]"
          style={{ left: `${tapeLeft}%` }}
        />
      ) : null}
      {clip ? <PaperClip seed={seed} className="-top-3 right-6 h-[3.4rem] w-[1.3rem]" /> : null}
      {showStain ? <CoffeeRing seed={seed} /> : null}

      <div className="relative">{children}</div>
    </Tag>
  );
}

/** 胶带装饰：旧 API 兼容层，内部走 WashiTape */
export function TapeDecoration({ seed = 0 }: { seed?: number | string }) {
  return <WashiTape seed={seed} className="-top-2.5 h-[1.1rem] w-[4.4rem]" style={{ left: `${12 + seedMod(seed, 64)}%` }} />;
}

/* ───────────────────────── 按钮：厚纸片冲切 ───────────────────────── */

export function PaperButton({
  children,
  variant = "secondary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const variants = {
    // 主按钮 = 一枚厚纸片：顶边高光 + 底边纸厚 + 接触影；按下时纸被压平
    primary:
      "bg-sage text-paper-strong shadow-[inset_0_1px_0_rgba(255,255,255,.34),inset_0_-2px_0_rgba(40,56,42,.32),0_1px_1px_rgba(74,55,34,.3),0_4px_7px_-2px_rgba(74,55,34,.3)] hover:brightness-[1.06] hover:-translate-y-[1px] active:translate-y-[1.5px] active:shadow-[inset_0_1px_2px_rgba(40,56,42,.4)]",
    secondary:
      "bg-paper-strong text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.85),inset_0_-1.5px_0_rgba(122,92,56,.18),0_1px_1px_rgba(74,55,34,.22),0_3px_6px_-2px_rgba(74,55,34,.22)] hover:-translate-y-[1px] hover:brightness-[1.02] active:translate-y-[1.5px] active:shadow-[inset_0_1px_2px_rgba(122,92,56,.3)]",
    ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-ink/8 active:translate-y-[1px]",
    danger:
      "bg-rose/90 text-paper-strong shadow-[inset_0_1px_0_rgba(255,255,255,.3),inset_0_-2px_0_rgba(120,58,52,.3),0_1px_1px_rgba(74,55,34,.3),0_4px_7px_-2px_rgba(74,55,34,.3)] hover:brightness-[1.06] hover:-translate-y-[1px] active:translate-y-[1.5px] active:shadow-[inset_0_1px_2px_rgba(120,58,52,.4)]",
  } as const;

  return (
    <button
      {...rest}
      className={clsx(
        "paper-focus inline-flex items-center justify-center gap-1.5 rounded-[3px] px-3.5 py-2 text-sm font-medium transition-all duration-(--dur-fast) ease-(--ease-spring-soft) disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0",
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
  sage: "bg-sage/25 text-[#3f5c44] border-sage/50",
  sun: "bg-sun/30 text-[#7d5a10] border-sun/60",
  rose: "bg-rose/28 text-[#8c443c] border-rose/55",
  sky: "bg-sky/28 text-[#33596c] border-sky/55",
  ink: "bg-ink/10 text-ink border-ink/30",
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
        // 冲切感：一侧直角一侧圆角 + 细虚线描边（裁切痕）+ 顶边高光（纸厚）
        "paper-focus inline-flex h-6 items-center rounded-l-[7px] rounded-r-[2px] border border-dashed px-2 text-xs font-medium leading-none",
        "shadow-[inset_0_1px_0_rgba(255,255,255,.5),0_1px_1px_rgba(74,55,34,.2)]",
        "transition-all duration-(--dur-fast) ease-(--ease-spring-soft)",
        base,
        active && "ring-1 ring-ink/45",
        onClick
          ? "cursor-pointer hover:-translate-y-[1.5px] hover:rotate-[-1deg] hover:shadow-[inset_0_1px_0_rgba(255,255,255,.5),0_3px_6px_rgba(74,55,34,.24)]"
          : "cursor-default",
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
  // 一半用胶带贴，一半用回形针夹：桌面上才有「随手摆的」感觉
  const useClip = seedMod(`${seed}-m`, 3) === 0;

  return (
    <figure
      className={clsx("polaroid photo-settle washi-press relative p-[7px] pb-0", className)}
      style={{ rotate: `${tilt}deg` }}
    >
      {useClip ? (
        <PaperClip seed={seed} className="-top-4 h-[3.6rem] w-[1.4rem]" />
      ) : (
        <WashiTape
          seed={seed}
          className="-top-2.5 h-[1.1rem] w-[3.4rem]"
          style={{ left: `${tapeLeft}%` }}
        />
      )}
      <div className="polaroid-window">
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
      </div>
      {caption ? (
        <figcaption className="hand-note truncate px-1 py-1.5 text-center text-[11px] leading-tight">{caption}</figcaption>
      ) : (
        <div aria-hidden className="h-3.5" />
      )}
      {children}
    </figure>
  );
}

/* ───────────────────────── 手写批注（§3.5）：只承载 2–12 字的情绪点缀 ───────────────────────── */

export function HandNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={clsx("hand-note text-xs", className)}>{children}</span>;
}
