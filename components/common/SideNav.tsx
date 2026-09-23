"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { signOut } from "next-auth/react";
import { WashiTape } from "@/components/paper/PaperCard";

const ITEMS = [
  { href: "/timeline", label: "时间线", hint: "今天", icon: "⌂" },
  { href: "/calendar", label: "日历", hint: "归档", icon: "▦" },
  { href: "/photos", label: "相册", hint: "照片", icon: "▧" },
  { href: "/reviews", label: "AI 复盘", hint: "回顾", icon: "✦" },
  { href: "/search", label: "搜索回忆", hint: "Cmd+K", icon: "⌕" },
  { href: "/settings", label: "设置", hint: "账户 / AI", icon: "⚙" },
];

export function SideNav({ displayName }: { displayName: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-full flex-col gap-1.5 px-4 py-5" aria-label="主导航">
      {/* 品牌卡 = 贴在牛皮纸板上的一张名片纸：毛边 + 胶带压角 */}
      <Link href="/timeline" className="paper-piece paper-focus group mb-5 flex flex-col gap-1 px-3 py-3">
        <span aria-hidden className="paper-sheet" style={{ "--sheet-color": "#fdf7ea" } as React.CSSProperties} />
        <WashiTape seed="brand" className="-top-2 left-6 h-[1rem] w-[3.6rem]" />
        <span className="relative flex items-center gap-2.5">
          {/* Logo：三层叠纸 —— 牛皮纸底 + 撕边米白 + 鼠标悬停时彩色纸片轻跳 */}
          <span aria-hidden className="relative inline-flex h-9 w-9 items-center justify-center">
            <span className="absolute inset-0 rotate-[6deg] rounded-[4px] bg-sun/70 transition-transform duration-(--dur-fast) group-hover:rotate-[10deg]" />
            <span className="absolute inset-0 -rotate-[5deg] rounded-[4px] bg-rose/70 transition-transform duration-(--dur-fast) group-hover:-rotate-[8deg]" />
            <span className="relative flex h-7 w-7 items-center justify-center rounded-[4px] bg-paper-strong text-base shadow-[0_2px_6px_rgba(76,58,39,0.25)] font-(--font-serif-cn)">
              剪
            </span>
          </span>
          <span className="font-(--font-serif-cn) text-xl tracking-[0.06em] text-ink">{displayName}</span>
        </span>
        <span className="hand-note relative pl-11 text-[12px] text-ink-muted">MY DIARY · 记录生活</span>
      </Link>

      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "paper-focus group relative flex items-center gap-3 rounded-[3px] px-3 py-2.5 text-sm font-medium transition-all duration-(--dur-normal) ease-(--ease-spring-soft)",
              active
                ? "bg-paper-strong/95 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_1px_1px_rgba(74,55,34,.22),0_4px_8px_-3px_rgba(74,55,34,.28)] -translate-y-[1px]"
                : "text-ink/90 hover:bg-paper-strong/60 hover:-translate-y-[1px] hover:shadow-[0_2px_6px_-2px_rgba(74,55,34,.24)]",
            )}
          >
            {active ? (
              /* 当前页标记：左侧一小片手撕彩纸（不是 border，是贴上去的） */
              <span
                aria-hidden
                className="absolute -left-1 top-1/2 h-5 w-2.5 -translate-y-1/2"
                style={{
                  background: "linear-gradient(180deg, rgba(110,139,114,.9), rgba(110,139,114,.55))",
                  WebkitMaskImage: "var(--deckle-3)",
                  maskImage: "var(--deckle-3)",
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                  filter: "drop-shadow(1px 0 1px rgba(74,55,34,.24))",
                }}
              />
            ) : null}
            <span aria-hidden className="w-5 text-center text-lg leading-none opacity-80 transition-opacity group-hover:opacity-100">
              {item.icon}
            </span>
            <span className="flex-1">{item.label}</span>
            <span className="text-[10px] text-ink-muted/80 transition-colors group-hover:text-ink-muted">{item.hint}</span>
          </Link>
        );
      })}

      <div className="mt-auto flex items-center justify-between px-1 pt-6 text-xs text-ink">
        <span className="hand-note truncate">{displayName}</span>
        <button
          type="button"
          className="paper-focus underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
          onClick={() => void signOut({ callbackUrl: "/login" })}
        >
          登出
        </button>
      </div>
    </nav>
  );
}
