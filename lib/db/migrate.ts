import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { execScript, getDb, type Database } from "./client";
import { dbLogger } from "@/lib/obs/logger";

/**
 * 迁移执行器。
 * - 迁移文件即 drizzle/ 目录下按序号排列的 SQL，人工审阅后方可提交。
 * - 已执行的迁移记录在 _migrations 表，重复执行是幂等的。
 * - 禁止在生产使用 db push。
 */

const MIGRATIONS_DIR = resolve(process.cwd(), "drizzle");

interface Applied {
  name: string;
}

async function ensureMetaTable(db: Database) {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS _migrations (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`,
  );
}

/**
 * 不同驱动下 db.execute 的返回形态不一致：
 * postgres.js 直接给行数组，PGlite 给 { rows: [...] }。统一归一化。
 */
function rowsOf(result: unknown): Applied[] {
  if (Array.isArray(result)) return result as Applied[];
  const rows = (result as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(rows) ? (rows as Applied[]) : [];
}

function listMigrationFiles(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function runMigrations(): Promise<string[]> {
  const db = await getDb();
  await ensureMetaTable(db);

  const appliedRows = rowsOf(await db.execute(sql`SELECT name FROM _migrations`));
  const applied = new Set(appliedRows.map((r) => r.name));

  const files = listMigrationFiles();
  const done: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const statements = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    dbLogger.info({ migration: file }, "执行迁移");
    // 逐条执行，便于定位失败语句；DDL 失败直接抛出，不做静默跳过
    await execScript(db, statements);
    await db.execute(sql`INSERT INTO _migrations (name) VALUES (${file}) ON CONFLICT DO NOTHING`);
    done.push(file);
  }

  return done;
}

/** 开发态：首次访问数据库时自动补齐 schema，避免忘记执行 migrate */
let schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  schemaReady ??= runMigrations()
    .then(() => undefined)
    .catch((err) => {
      schemaReady = null;
      throw err;
    });
  return schemaReady;
}
