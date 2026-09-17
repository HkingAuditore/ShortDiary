import type { NextRequest } from "next/server";
import { z } from "zod";
import { defineRoute, type RouteCtx } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { deleteTag, updateTag } from "@/lib/tag/tag.repo";
import { AppError } from "@/lib/errors/app-error";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(32).optional(),
  colorToken: z.enum(["sage", "sun", "rose", "sky", "ink"]).optional(),
});

export const PATCH = defineRoute(async (req: NextRequest, ctx: RouteCtx) => {
  const sctx = await serviceContext();
  const body = patchSchema.parse(await req.json());
  const row = await updateTag(sctx.userId, ctx.params.id ?? "", body);
  if (!row) throw AppError.notFound("标签不存在");
  return { data: row };
});

export const DELETE = defineRoute(async (_req: NextRequest, ctx: RouteCtx) => {
  const sctx = await serviceContext();
  const ok = await deleteTag(sctx.userId, ctx.params.id ?? "");
  if (!ok) throw AppError.notFound("标签不存在");
  return { data: { ok: true } };
});
