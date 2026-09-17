import { requireUser, type SessionUser } from "@/lib/auth/guard";
import type { ServiceContext } from "@/lib/entry/entry.service";
import { ensureSchema } from "@/lib/db/migrate";

/**
 * API 边界：从 JWT session 取 userId，永不接受客户端传入的 user_id。
 */
export async function serviceContext(): Promise<ServiceContext & { user: SessionUser }> {
  await ensureSchema();
  const user = await requireUser();
  return {
    user,
    userId: user.id,
    timezone: user.timezone,
    preferences: { autoAnnotate: user.preferences?.autoAnnotate !== false },
  };
}
