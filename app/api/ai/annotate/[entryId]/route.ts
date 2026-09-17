import type { NextRequest } from "next/server";
import { defineRoute, type RouteCtx } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { enqueue } from "@/lib/jobs/queue";
import { findEntryById, updateEntry } from "@/lib/entry/entry.repo";
import { AppError } from "@/lib/errors/app-error";
import { contentHash } from "@/lib/utils/hash";

export const dynamic = "force-dynamic";

/** 手动触发单条 AI 整理 */
export const POST = defineRoute(
  async (_req: NextRequest, ctx: RouteCtx) => {
    const sctx = await serviceContext();
    const entryId = ctx.params.entryId ?? "";
    const entry = await findEntryById(sctx.userId, entryId);
    if (!entry || entry.deletedAt) throw AppError.notFound("记录不存在");

    const { id: jobId } = await enqueue({
      type: "ai_annotate",
      payload: { entryId, userId: sctx.userId },
      idempotencyKey: `annotate:${entryId}:${contentHash(entryId, entry.contentHash)}`,
    });

    await updateEntry(sctx.userId, entryId, { aiStatus: "queued" }).catch(() => undefined);
    return { data: { jobId, aiStatus: "queued" }, status: 202 };
  },
  { rateLimit: { limit: 30 } },
);
