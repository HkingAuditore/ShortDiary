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

/** 移动端底部导航：主操作区永远在拇指可及范围 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="底部导航"
      className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-ink/10 bg-paper-strong/95 backdrop-blur md:hidden"
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
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
              active ? "text-ink" : "text-ink-faint",
            )}
          >
            <span
              aria-hidden
              className={clsx("mb-0.5 h-1 w-6 rounded-full", active ? "bg-sage" : "bg-ink/10")}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
