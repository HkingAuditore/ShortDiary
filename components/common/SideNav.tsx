"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { signOut } from "next-auth/react";

const ITEMS = [
  { href: "/timeline", label: "时间线", hint: "今天" },
  { href: "/calendar", label: "日历", hint: "归档" },
  { href: "/photos", label: "相册", hint: "照片" },
  { href: "/reviews", label: "AI 复盘", hint: "回顾" },
  { href: "/search", label: "搜索回忆", hint: "Cmd+K" },
  { href: "/settings", label: "设置", hint: "账户 / AI" },
];

export function SideNav({ displayName }: { displayName: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-full flex-col gap-1 px-3 py-4" aria-label="主导航">
      <Link href="/timeline" className="paper-focus mb-3 flex items-center gap-2 px-2">
        <span aria-hidden className="inline-block h-4 w-4 rotate-[8deg] bg-sage/70" />
        <span className="font-(--font-serif-cn) text-lg tracking-wide">剪纸日记</span>
      </Link>

      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "paper-focus flex items-baseline justify-between rounded-[3px] px-2.5 py-2 text-sm transition-colors",
              active ? "bg-paper-strong text-ink shadow-(--shadow-paper)" : "text-ink/75 hover:bg-paper-strong/60",
            )}
          >
            <span>{item.label}</span>
            <span className="text-[11px] text-ink-faint">{item.hint}</span>
          </Link>
        );
      })}

      <div className="mt-auto flex items-center justify-between px-2.5 pt-4 text-xs text-ink-muted">
        <span className="truncate">{displayName}</span>
        <button
          type="button"
          className="paper-focus underline decoration-dotted underline-offset-2"
          onClick={() => void signOut({ callbackUrl: "/login" })}
        >
          登出
        </button>
      </div>
    </nav>
  );
}
