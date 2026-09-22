import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { serviceContext } from "@/lib/api/context";
import { listEntries } from "@/lib/entry/entry.service";
import { Composer } from "@/components/entry/Composer";
import { EntryList } from "@/components/entry/EntryList";
import { OnThisDay } from "@/components/entry/OnThisDay";
import { PageShell, AsideCard } from "@/components/common/PageShell";
import { formatChineseDate, today } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

/**
 * 时间线首屏（§3.10.1）：顶部只呈现日期和一句短文本，
 * 用户打开应用后 1 秒内明确知道「在哪里输入」。
 * RSC 直出第一页；右栏为今日小结 + 回忆卡。
 */
export default async function TimelinePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const ctx = await serviceContext();
  const page = await listEntries(ctx, { limit: 30 });
  const todayStr = today(ctx.timezone);
  const todayCount = page.items.filter((e) => e.entryDate === todayStr).length;
  const todayStarred = page.items.filter((e) => e.entryDate === todayStr && e.starred).length;

  const aside = (
    <>
      <AsideCard title="今日" seed="today-brief">
        <p className="hand-note mb-2 text-[13px] text-ink">
          {formatChineseDate(todayStr)}
        </p>
        <p className="text-xs leading-relaxed text-ink-muted">
          今天已有 <span className="font-medium text-ink">{todayCount}</span> 条记录
          {todayStarred > 0 ? (
            <>
              ，其中 <span className="text-sun">★ {todayStarred}</span> 条被你标星
            </>
          ) : null}
          。
        </p>
        {todayCount === 0 ? (
          <p className="mt-1.5 hand-note text-[11px] text-sage">从上面那条纸开始写吧</p>
        ) : null}
      </AsideCard>
      {/* 回忆卡是「锦上添花」，不阻塞时间线首屏：流式渲染，晚到晚画 */}
      <Suspense fallback={null}>
        <OnThisDay userId={ctx.userId} timezone={ctx.timezone} />
      </Suspense>
    </>
  );

  return (
    <PageShell aside={aside}>
      <div className="space-y-4">
        <Composer timezone={ctx.timezone} today={todayStr} />
        <EntryList
          timezone={ctx.timezone}
          today={todayStr}
          initialPage={{
            data: page.items,
            meta: { nextCursor: page.nextCursor ?? undefined, hasMore: page.hasMore },
          }}
        />
      </div>
    </PageShell>
  );
}
