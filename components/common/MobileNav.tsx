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

/** 移动端底部导航：主操作区永远在拇指可及范围；瓦楞纸底 + 山形剪影 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="底部导航"
      className="corrugated paper-hills fixed bottom-0 left-0 right-0 z-40 flex border-t border-ink/10 bg-paper-strong/95 backdrop-blur md:hidden"
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
              "paper-focus flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] transition-all duration-(--dur-fast)",
              active ? "text-ink" : "text-ink-faint",
            )}
          >
            {/* 当前项：一枚小彩纸片压在导航上 */}
            <span
              aria-hidden
              className={clsx(
                "mb-0.5 h-1.5 w-6 rounded-full transition-all duration-(--dur-fast)",
                active ? "bg-sage shadow-[0_1px_2px_rgba(76,58,39,0.25)] -translate-y-[1px]" : "bg-ink/10",
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
