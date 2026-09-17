// tsx 不会自动加载 .env（只有 next 会），脚本必须自己加载，
// 否则 env.ts 的快速失败校验会直接抛错。
import "dotenv/config";

import { runMigrations } from "@/lib/db/migrate";

/**
 * 手动执行迁移：npm run db:migrate
 * 生产部署在启动时由 instrumentation.ts 自动执行；这里给需要显式控制时使用。
 */
async function main() {
  const applied = await runMigrations();
  if (applied.length === 0) {
    console.log("没有待执行的迁移。");
    return;
  }
  console.log(`已应用 ${applied.length} 个迁移：`);
  for (const name of applied) console.log(`  - ${name}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
