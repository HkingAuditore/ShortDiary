import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { SideNav } from "@/components/common/SideNav";
import { MobileNav } from "@/components/common/MobileNav";
import { CommandPalette } from "@/components/common/CommandPalette";

/**
 * 应用外壳。服务端先断言登录态 —— 未登录直接重定向，
 * 避免客户端闪一下空白页再跳转。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="flex min-h-screen bg-paper-bg">
      <aside className="corrugated sticky top-0 hidden h-screen w-56 shrink-0 border-r border-ink/10 md:block">
        <SideNav displayName={session.user.name ?? "我"} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10">{children}</main>
        <MobileNav />
      </div>

      <CommandPalette />
    </div>
  );
}
