"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

const ITEMS = [
  { href: "/timeline", label: "时间线" },
  { href: "/calendar", label: "日历" },
  { href: "/photos", label: "相册" },
  { href: "/reviews", label: "复盘" },
  { href: "/settings", label: "设置" },
];

/**
 * 移动端底部导航：主操作区永远在拇指可及范围。
 * 瓦楞纸底 + 山峦剪影（.paper-mobile-nav，与左侧栏同语言）；
 * 当前页是一枚微微歪着的冲切小纸片，压在瓦楞纸上。
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="底部导航"
      className="paper-mobile-nav fixed bottom-0 left-0 right-0 z-40 flex md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "paper-focus relative flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1.5 text-xs font-medium transition-all duration-(--dur-fast)",
              active ? "text-ink" : "text-ink/70",
            )}
          >
            {/* 当前项：一枚冲切小纸片垫在底下，微微歪着 —— relative 提层，避免被山峦伪元素盖住 */}
            <span
              aria-hidden
              className={clsx(
                "absolute inset-x-1.5 top-1 bottom-1 rounded-[4px] transition-all duration-(--dur-fast) ease-(--ease-paper)",
                active
                  ? "-rotate-[0.8deg] bg-paper-card shadow-[0_1px_5px_rgba(76,58,39,0.16)]"
                  : "rotate-0 bg-transparent shadow-none",
              )}
            />
            <span
              aria-hidden
              className={clsx(
                "relative h-1.5 w-6 rounded-full transition-all duration-(--dur-fast)",
                active
                  ? "bg-sage shadow-[0_1px_2px_rgba(76,58,39,0.25)]"
                  : "scale-x-50 bg-ink/10 opacity-60",
              )}
            />
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
