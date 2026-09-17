import type { NextRequest } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { fetchCalendarStats } from "@/lib/db/queries/timeline";
import { endOfMonth, startOfMonth, today } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2999).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

/** 日历热力：一次聚合整月，避免逐日查询 */
export const GET = defineRoute(async (req: NextRequest) => {
  const ctx = await serviceContext();
  const url = new URL(req.url);
  const query = querySchema.parse(Object.fromEntries(url.searchParams));

  const anchor = query.year && query.month
    ? `${query.year}-${String(query.month).padStart(2, "0")}-01`
    : `${today(ctx.timezone).slice(0, 7)}-01`;

  const stats = await fetchCalendarStats(ctx.userId, startOfMonth(anchor), endOfMonth(anchor));
  return { data: { month: anchor.slice(0, 7), days: stats } };
});
