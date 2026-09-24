import { cache } from "react";
import { auth } from "./auth";
import { AppError } from "@/lib/errors/app-error";
import { getDb } from "@/lib/db/client";
import { withDbRetry } from "@/lib/db/retry";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { User } from "@/lib/db/schema";

/**
 * 会话边界：所有 API 与页面都必须从这里拿 userId，
 * 永不接受客户端传入的 user_id（Zod schema 也会 strip 掉该字段）。
 * cache()：同一次请求内（layout + page + 各 service 多处调用）只查一次 users 表。
 */

export interface SessionUser {
  id: string;
  displayName: string;
  timezone: string;
  email: string | null;
  preferences: User["preferences"];
}

export async function _getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  // 无服务器平台上这次查询是最先碰到数据库的地方：实例冻结后的死连接、
  // 远端库挂起后的冷连都会在这里炸，不重试就等于整页 500。只读查询，重试幂等。
  return withDbRetry(
    async () => {
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
    },
    { scope: "session" },
  );
}

export const getSessionUser = cache(_getSessionUser);

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHENTICATED");
  return user;
}
