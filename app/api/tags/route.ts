import type { NextRequest } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { listTags, ensureTags } from "@/lib/tag/tag.repo";

export const dynamic = "force-dynamic";

export const GET = defineRoute(async () => {
  const ctx = await serviceContext();
  const tags = await listTags(ctx.userId);
  return { data: tags };
});

const createSchema = z.object({ name: z.string().trim().min(1).max(32) });

/** 同名标签不重复创建（UNIQUE(user_id, name)） */
export const POST = defineRoute(async (req: NextRequest) => {
  const ctx = await serviceContext();
  const body = createSchema.parse(await req.json());
  const rows = await ensureTags(ctx.userId, [body.name], "manual");
  return { data: rows[0] ?? null, status: 201 };
});
