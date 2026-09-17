import type { NextRequest } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  timezone: z.string().min(2).max(64).optional(),
  preferences: z
    .object({
      privacyMode: z.boolean().optional(),
      moodAnalysis: z.boolean().optional(),
      simpleMode: z.boolean().optional(),
      autoAnnotate: z.boolean().optional(),
      defaultHome: z.enum(["timeline", "today"]).optional(),
    })
    .optional(),
});

export const GET = defineRoute(async () => {
  const ctx = await serviceContext();
  return {
    data: {
      id: ctx.user.id,
      displayName: ctx.user.displayName,
      timezone: ctx.user.timezone,
      email: ctx.user.email,
      preferences: ctx.user.preferences,
    },
  };
});

export const PATCH = defineRoute(async (req: NextRequest) => {
  const ctx = await serviceContext();
  const body = patchSchema.parse(await req.json());

  const db = await getDb();
  const rows = await db
    .update(users)
    .set({
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.preferences !== undefined
        ? { preferences: { ...(ctx.user.preferences ?? {}), ...body.preferences } }
        : {}),
    })
    .where(eq(users.id, ctx.userId))
    .returning();

  const row = rows[0];
  return {
    data: row
      ? { id: row.id, displayName: row.displayName, timezone: row.timezone, email: row.email, preferences: row.preferences }
      : null,
  };
});
