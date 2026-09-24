import { requireUser, type SessionUser } from "@/lib/auth/guard";
import type { ServiceContext } from "@/lib/entry/entry.service";
import { ensureSchema } from "@/lib/db/migrate";
import { withDbRetry } from "@/lib/db/retry";

/**
 * API 边界：从 JWT session 取 userId，永不接受客户端传入的 user_id。
 */
export async function serviceContext(): Promise<ServiceContext & { user: SessionUser }> {
  // 所有页面/接口的第一道数据库关卡：ensureSchema 的 _migrations 查询和
  // requireUser 的 users 查询都在这里。连接抖动时这里重试一次，后面的
  // 业务查询就能用上重建好的连接池。
  return withDbRetry(
    async () => {
      await ensureSchema();
      const user = await requireUser();
      return {
        user,
        userId: user.id,
        timezone: user.timezone,
        preferences: { autoAnnotate: user.preferences?.autoAnnotate !== false },
      };
    },
    { scope: "serviceContext" },
  );
}
