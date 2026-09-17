import type { NextRequest } from "next/server";
import { defineRoute, type RouteCtx } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { setEntryTagsSchema } from "@/lib/entry/entry.schema";
import { setEntryTags } from "@/lib/tag/tag.repo";
import { getEntry } from "@/lib/entry/entry.service";

export const dynamic = "force-dynamic";

/** 全量替换标签：人工标签优先，AI 建议不覆盖用户已确认的绑定 */
export const PUT = defineRoute(async (req: NextRequest, ctx: RouteCtx) => {
  const sctx = await serviceContext();
  const body = setEntryTagsSchema.parse(await req.json());
  await setEntryTags(sctx.userId, ctx.params.id ?? "", body.tags, "manual");
  const entry = await getEntry(sctx, ctx.params.id ?? "");
  return { data: entry };
});
