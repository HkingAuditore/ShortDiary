import "dotenv/config";

import { getDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";

/**
 * 一次性修复：zonedToUtc 旧算法把「当天默认写入」的 occurred_at 存成了
 * 该日 UTC 12:00:00.000 整（墙钟 12:00 被整体当 UTC，+8 机器上显示 20:00）。
 * 指纹（纯 SQL，避免 JS 侧时区字符串解析差异）：
 *   source='web' 且未删除 且 occurred_at ≠ created_at
 *   且 occurred_at 的 UTC 时间部分恰为 '12:00:00'（微秒级精确）。
 * 修正：occurred_at := created_at（真实写入时刻，不受该 bug 影响）。
 * 导入数据（source='import'）与补记数据（旧算法存的是其他整点墙钟）不会命中指纹。
 *
 * 用法：node node_modules/tsx/dist/cli.mjs scripts/fix-occurred-at.ts
 * 注意：必须单进程运行（先关 dev server）。
 */

async function main() {
  const db = await getDb();

  const found = await db.execute(sql`
    SELECT id, occurred_at::text AS occ, created_at::text AS cre
    FROM entries
    WHERE source = 'web'
      AND deleted_at IS NULL
      AND occurred_at <> created_at
      AND (occurred_at AT TIME ZONE 'UTC')::time = '12:00:00'
    ORDER BY created_at DESC
  `);
  const rows = (found as unknown as { rows: Array<{ id: string; occ: string; cre: string }> }).rows ?? [];
  console.log(`指纹命中 ${rows.length} 条`);
  for (const r of rows) console.log(`  ${r.id}: occ=${r.occ} -> cre=${r.cre}`);

  if (rows.length === 0) {
    console.log("没有需要修正的记录。");
    return;
  }

  const upd = await db.execute(sql`
    UPDATE entries
    SET occurred_at = created_at
    WHERE source = 'web'
      AND deleted_at IS NULL
      AND occurred_at <> created_at
      AND (occurred_at AT TIME ZONE 'UTC')::time = '12:00:00'
  `);
  console.log("UPDATE 结果:", JSON.stringify(upd));

  // 复核
  const recheck = await db.execute(sql`
    SELECT count(*) AS n
    FROM entries
    WHERE source = 'web'
      AND deleted_at IS NULL
      AND occurred_at <> created_at
      AND (occurred_at AT TIME ZONE 'UTC')::time = '12:00:00'
  `);
  const n = ((recheck as unknown as { rows: Array<{ n: number | string }> }).rows ?? [])[0]?.n;
  console.log(`复核剩余命中: ${n}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
