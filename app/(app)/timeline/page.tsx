import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { serviceContext } from "@/lib/api/context";
import { withDbRetry } from "@/lib/db/retry";
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
  // 首屏唯一的重查询：会话查询已把连接池重建好，这里再兜一层重试
  const page = await withDbRetry(() => listEntries(ctx, { limit: 30 }), { scope: "timeline.list" });
  const todayStr = today(ctx.timezone);
  const todayCount = page.items.filter((e) => e.entryDate === todayStr).length;
  const todayStarred = page.items.filter((e) => e.entryDate === todayStr && e.starred).length;

  const aside = (
    <>
      <AsideCard title="今日" seed="today-brief">
        <p className="hand-note mb-2 text-[14px] text-ink">
          {formatChineseDate(todayStr)}
        </p>
        <p className="text-xs leading-relaxed text-ink-muted">
          今天已有 <span className="font-medium text-ink">{todayCount}</span> 条记录
          {todayStarred > 0 ? (
            <>
              ，其中 <span className="font-medium text-sun">★ {todayStarred}</span> 条被你标星
            </>
          ) : null}
          。
        </p>
        {todayCount === 0 ? (
          <p className="mt-1.5 hand-note text-[12px] text-sage">从上面那条纸开始写吧</p>
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
      <div className="space-y-5">
        <header className="paper-page-heading flex flex-wrap items-end justify-between gap-4 px-2 pb-1 pt-1">
          <div className="relative">
            <p className="hand-note text-xs tracking-wide text-ink-muted">A Brighter Day · One Page at a Time</p>
            <h1 className="relative mt-2 inline-block font-(--font-serif-cn) text-3xl tracking-[0.08em] text-ink sm:text-4xl">
              {formatChineseDate(todayStr)}
              {/* 标题底衬：一条蜡笔划痕，像写完顺手勾了一道 */}
              <span
                aria-hidden
                className="absolute -bottom-1 left-0 right-0 h-[0.55em] opacity-55"
                style={{
                  backgroundImage: "url(/art-kit/assets/crayon/underline.svg)",
                  backgroundSize: "100% 100%",
                  backgroundRepeat: "no-repeat",
                  transform: "rotate(-0.8deg)",
                }}
              />
            </h1>
          </div>
          <div className="paper-weather-note hand-note sticky-note -rotate-[1.6deg] px-3.5 py-2.5 text-[13px] text-ink">
            ☀ 今天也要好好生活
          </div>
        </header>
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
