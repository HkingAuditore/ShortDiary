import { auth } from "./auth";
import { AppError } from "@/lib/errors/app-error";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { User } from "@/lib/db/schema";

/**
 * 会话边界：所有 API 与页面都必须从这里拿 userId，
 * 永不接受客户端传入的 user_id（Zod schema 也会 strip 掉该字段）。
 */

export interface SessionUser {
  id: string;
  displayName: string;
  timezone: string;
  email: string | null;
  preferences: User["preferences"];
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const user = rows[0];
  if (!user) return null;

  return {
    id: user.id,
    displayName: user.displayName,
    timezone: user.timezone,
    email: user.email,
    preferences: user.preferences ?? {},
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHENTICATED");
  return user;
}
