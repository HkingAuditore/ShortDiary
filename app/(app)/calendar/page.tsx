import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { serviceContext } from "@/lib/api/context";
import { CalendarBoard } from "@/components/calendar/CalendarBoard";
import { PageShell, AsideCard } from "@/components/common/PageShell";
import { today } from "@/lib/utils/date";
import { HandNote } from "@/components/paper/PaperCard";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const ctx = await serviceContext();
  const [y, m] = today(ctx.timezone).split("-").map(Number) as [number, number];

  const aside = (
    <AsideCard title="怎么读这张日历" seed="calendar-help">
      <p className="space-y-1.5 text-xs leading-relaxed text-ink-muted">
        <span className="block">
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sage" />
          绿点数量 = 当天记录条数
        </span>
        <span className="block">
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sky" />
          蓝点 = 那天有照片
        </span>
        <span className="block">
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sun" />
          黄点 = 那天有星标
        </span>
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">点击任意有记录的日期，直接翻到那一天。</p>
      <HandNote className="mt-3 block text-[11px]">翘起来的小纸片就是写过字的日子</HandNote>
    </AsideCard>
  );

  return (
    <PageShell aside={aside}>
      <CalendarBoard initialYear={y} initialMonth={m} timezone={ctx.timezone} />
    </PageShell>
  );
}
