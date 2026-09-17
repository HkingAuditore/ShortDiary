import type { NextRequest } from "next/server";
import { defineRoute, type RouteCtx } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { getEntry, softDelete, updateEntry } from "@/lib/entry/entry.service";
import { updateEntrySchema } from "@/lib/entry/entry.schema";
import { AppError } from "@/lib/errors/app-error";

export const dynamic = "force-dynamic";

export const GET = defineRoute(async (_req: NextRequest, ctx: RouteCtx) => {
  const sctx = await serviceContext();
  const entry = await getEntry(sctx, ctx.params.id ?? "");
  if (!entry) throw AppError.notFound("记录不存在");
  return { data: entry };
});

export const PATCH = defineRoute(async (req: NextRequest, ctx: RouteCtx) => {
  const sctx = await serviceContext();
  const body = updateEntrySchema.parse(await req.json());
  const entry = await updateEntry(sctx, ctx.params.id ?? "", body);
  return { data: entry };
});

/** 软删除：COS 文件保留，30 分钟内可撤销 */
export const DELETE = defineRoute(async (_req: NextRequest, ctx: RouteCtx) => {
  const sctx = await serviceContext();
  const result = await softDelete(sctx, ctx.params.id ?? "");
  return { data: result };
});
