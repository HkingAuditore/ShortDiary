import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { serviceContext } from "@/lib/api/context";
import { listEntries } from "@/lib/entry/entry.service";
import { Composer } from "@/components/entry/Composer";
import { EntryList } from "@/components/entry/EntryList";
import { OnThisDay } from "@/components/entry/OnThisDay";
import { today } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

/**
 * 时间线首屏由 RSC 直出第一页：客户端拿到 initialPage 后不再重复请求，
 * 后续滚动才走游标分页。
 */
export default async function TimelinePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const ctx = await serviceContext();
  const page = await listEntries(ctx, { limit: 30 });
  const todayStr = today(ctx.timezone);

  return (
    <div className="space-y-4">
      <Composer timezone={ctx.timezone} today={todayStr} />
      <OnThisDay userId={ctx.userId} timezone={ctx.timezone} />
      <EntryList
        timezone={ctx.timezone}
        today={todayStr}
        initialPage={{
          data: page.items,
          meta: { nextCursor: page.nextCursor ?? undefined, hasMore: page.hasMore },
        }}
      />
    </div>
  );
}
