import { defineRoute } from "@/lib/api/route";
import { getDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { driverName } from "@/lib/storage";
import { AppError } from "@/lib/errors/app-error";

export const dynamic = "force-dynamic";

/** 就绪检查：数据库连接 + 存储驱动可用性 */
export const GET = defineRoute(async () => {
  const checks: Record<string, boolean> = {};

  try {
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    checks.database = true;
  } catch {
    checks.database = false;
  }

  checks.storage = Boolean(driverName());

  const ready = Object.values(checks).every(Boolean);
  if (!ready) {
    throw new AppError("INTERNAL", "服务未就绪", { checks });
  }
  return { data: { ready, checks } };
});
