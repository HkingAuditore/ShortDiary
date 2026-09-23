"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { signOut } from "next-auth/react";

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
    <nav className="flex h-full w-full flex-col gap-1 px-3 py-5" aria-label="主导航">
      <Link href="/timeline" className="paper-nav-brand paper-focus group mb-6 flex flex-col gap-1 rounded-[10px] bg-paper-card/55 px-3 py-3 shadow-[0_5px_14px_rgba(76,58,39,0.08)]">
        <span className="flex items-center gap-2.5">
          {/* Logo：三层叠纸 —— 牛皮纸底 + 撕边米白 + 鼠标悬停时彩色纸片轻跳 */}
          <span aria-hidden className="relative inline-flex h-9 w-9 items-center justify-center">
            <span className="absolute inset-0 rotate-[6deg] rounded-[4px] bg-sun/70 transition-transform duration-(--dur-fast) group-hover:rotate-[10deg]" />
            <span className="absolute inset-0 -rotate-[5deg] rounded-[4px] bg-rose/70 transition-transform duration-(--dur-fast) group-hover:-rotate-[8deg]" />
            <span className="relative flex h-7 w-7 items-center justify-center rounded-[4px] bg-paper-strong text-base shadow-[0_2px_6px_rgba(76,58,39,0.25)] font-(--font-serif-cn)">
              剪
            </span>
          </span>
          <span className="font-(--font-serif-cn) text-xl tracking-wide text-ink">小日子</span>
        </span>
        <span className="hand-note pl-11 text-[11px]">MY DIARY · 记录生活</span>
      </Link>

      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "paper-focus relative flex items-center gap-3 rounded-[8px] px-3 py-3 text-sm transition-all duration-(--dur-fast) ease-out",
              active
                ? "bg-paper-strong text-ink shadow-(--shadow-paper) -translate-y-[1px]"
                : "text-ink/75 hover:bg-paper-strong/70 hover:-translate-y-[1px]",
            )}
          >
            {active ? (
              /* 当前页标记：左侧一小片冲切彩纸 */
              <span aria-hidden className="absolute -left-1 top-1/2 h-5 w-2 -translate-y-1/2 rounded-r-[3px] bg-sage shadow-[1px_0_2px_rgba(76,58,39,0.2)]" />
            ) : null}
            <span aria-hidden className="w-5 text-center text-lg leading-none opacity-80">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            <span className="text-[10px] text-ink-faint">{item.hint}</span>
          </Link>
        );
      })}

      <div className="mt-auto flex items-center justify-between px-3 pt-6 text-xs text-ink-muted">
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
