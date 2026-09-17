import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { dbLogger } from "@/lib/obs/logger";

/**
 * 数据库入口。
 * - 配置了 DATABASE_URL：走 postgres.js 驱动（prepared statement + pipeline，比 pg 快 20~40%）
 * - 未配置（本地开发/演示）：回退到内置 PGlite（WASM PostgreSQL），零外部依赖
 * 两种驱动对上层暴露同一套 Drizzle 接口，业务代码不感知差异。
 */

export type Database = PostgresJsDatabase<typeof schema>;

interface DbHolder {
  promise?: Promise<Database>;
}

const globalHolder = globalThis as unknown as { __pjDb?: DbHolder };
const holder: DbHolder = (globalHolder.__pjDb ??= {});

async function createDatabase(): Promise<Database> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const postgres = (await import("postgres")).default;
    const client = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: true,
      onnotice: () => {},
    });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    dbLogger.info({ driver: "postgres.js" }, "数据库已连接");
    return drizzle(client, { schema, logger: false }) as Database;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pgdata";
  // PGlite 的 nodefs 只会 mkdir 最后一级，父目录不存在时直接 ENOENT，这里先补上。
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  dbLogger.info({ driver: "pglite", dataDir }, "使用内置 PGlite 本地库（未配置 DATABASE_URL）");
  const instance = drizzle(client, { schema, logger: false });
  return instance as unknown as Database;
}

export function getDb(): Promise<Database> {
  holder.promise ??= createDatabase().catch((err) => {
    holder.promise = undefined;
    dbLogger.error({ err }, "数据库连接失败");
    throw err;
  });
  return holder.promise;
}

/** 底层驱动句柄：PGlite 暴露 exec()，postgres.js 暴露 unsafe()。 */
type RawClient = {
  exec?: (script: string) => Promise<unknown>;
  unsafe?: (script: string) => Promise<unknown>;
};

/**
 * 执行整段多语句脚本（迁移用）。
 * PGlite 的 db.execute 走扩展协议，一次只能一条语句，必须落到 exec()；
 * postgres.js 用 unsafe() 同样支持多语句。
 */
export async function execScript(db: Database, script: string): Promise<void> {
  const raw = (db as unknown as { $client?: RawClient }).$client;
  if (typeof raw?.exec === "function") {
    await raw.exec(script);
    return;
  }
  if (typeof raw?.unsafe === "function") {
    await raw.unsafe(script);
    return;
  }
  const { sql } = await import("drizzle-orm");
  await db.execute(sql.raw(script));
}

export { schema };
