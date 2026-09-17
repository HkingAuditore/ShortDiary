import "dotenv/config";

import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/crypto/envelope";
import { uuidv7 } from "@/lib/utils/uuid";
import { runMigrations } from "@/lib/db/migrate";

/**
 * 创建第一个用户：npm run bootstrap -- --login-id me --password ****
 * 单人自部署场景下这是唯一的建号入口；已存在同名账号时只更新口令与显示名。
 */

function arg(name: string, fallback = ""): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  const envKey = `BOOTSTRAP_${name.toUpperCase().replace(/-/g, "_")}`;
  return process.env[envKey] ?? fallback;
}

async function main() {
  await runMigrations();

  const loginId = arg("login-id") || "me";
  const password = arg("password");
  if (!password) {
    console.error("缺少口令：npm run bootstrap -- --login-id me --password your-password");
    process.exit(1);
  }
  const displayName = arg("name") || "我";
  const timezone = arg("timezone") || "Asia/Shanghai";

  const db = await getDb();
  const existing = await db.select().from(users).where(eq(users.loginId, loginId)).limit(1);
  const passwordHash = hashPassword(password);

  if (existing[0]) {
    await db
      .update(users)
      .set({ passwordHash, displayName, timezone })
      .where(eq(users.id, existing[0].id));
    console.log(`已更新账号：${loginId}`);
    return;
  }

  await db.insert(users).values({ id: uuidv7(), loginId, passwordHash, displayName, timezone, preferences: {} });
  console.log(`已创建账号：${loginId}（时区 ${timezone}）`);
  console.log("现在执行 npm run dev 并用该账号登录。");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
