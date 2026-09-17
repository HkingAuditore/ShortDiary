import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { fetchOnThisDay } from "@/lib/db/queries/timeline";
import { today } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

/** 「一年前的今天」：纯日期查询，无 AI 依赖 */
export const GET = defineRoute(async () => {
  const ctx = await serviceContext();
  const todayStr = today(ctx.timezone);
  const monthDay = todayStr.slice(5);
  const year = todayStr.slice(0, 4);

  const items = await fetchOnThisDay(ctx.userId, monthDay, year, 6);
  return { data: { date: todayStr, items } };
});
