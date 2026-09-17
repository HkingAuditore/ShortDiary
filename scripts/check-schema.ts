import "dotenv/config";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { getTableColumns, getTableName, is, sql, Table } from "drizzle-orm";

/**
 * 校验数据库实际列与 Drizzle schema 是否一致。
 * 迁移是手写 SQL，schema 改了而迁移没跟上时，错误只会在运行到那条 SQL 时才暴露，
 * 这个脚本用来在启动前一次性发现（npm run db:check）。
 */

interface ColumnRow {
  table_name: string;
  column_name: string;
}

function rowsOf(result: unknown): ColumnRow[] {
  if (Array.isArray(result)) return result as ColumnRow[];
  const rows = (result as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(rows) ? (rows as ColumnRow[]) : [];
}

const db = await getDb();

const actualRows = rowsOf(
  await db.execute(
    sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  ),
);

const actual = new Map<string, Set<string>>();
for (const row of actualRows) {
  const set = actual.get(row.table_name) ?? new Set<string>();
  set.add(row.column_name);
  actual.set(row.table_name, set);
}

const problems: string[] = [];

for (const value of Object.values(schema)) {
  if (!is(value, Table)) continue;
  const table = value;
  const name = getTableName(table);
  const columns = getTableColumns(table);
  const existing = actual.get(name);

  if (!existing) {
    problems.push(`缺少表：${name}`);
    continue;
  }

  // 注意：columns 的键是 TS 属性名（loginId），真正的列名在 column.name（login_id）
  for (const column of Object.values(columns)) {
    if (!existing.has(column.name)) {
      problems.push(`${name} 缺少列：${column.name}`);
    }
  }
}

if (problems.length === 0) {
  console.log(`schema 一致：已核对 ${actual.size} 张表。`);
  process.exit(0);
}

console.error(`发现 ${problems.length} 处不一致：`);
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
