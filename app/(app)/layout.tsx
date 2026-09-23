import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { SideNav } from "@/components/common/SideNav";
import { MobileNav } from "@/components/common/MobileNav";
import { CommandPalette } from "@/components/common/CommandPalette";

/**
 * 应用外壳（§3.3）：桌面三段式 —— 左侧瓦楞纸导航 + 中央主内容 + 页面自带右栏。
 * 右栏内容因页面而异，由各页通过 <AsideSlot> 注入，这里只负责网格骨架。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="paper-app-shell flex min-h-screen bg-paper-bg">
      <aside className="paper-sidebar sticky top-0 hidden h-screen w-60 shrink-0 border-r border-ink/10 md:block">
        <SideNav displayName={session.user.name ?? "我"} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="paper-main-stage mx-auto w-full max-w-[1240px] flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10">
          <span aria-hidden className="paper-scene-note hidden lg:block" />
          {children}
        </main>
        <MobileNav />
      </div>

      <CommandPalette />
    </div>
  );
}
