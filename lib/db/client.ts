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
    // Neon 等 serverless Postgres 的 pgbouncer 端点（连接串含 "pooler"）走事务模式，
    // 不支持 prepared statements。事务模式下连接无会话状态，可放少量并行：
    // RSC 页面请求与浏览器并发 API（如相册页多请求）不至于在单连接上排队。
    const pooled = /pooler/i.test(url);
    const client = postgres(url, {
      max: pooled ? 3 : 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: !pooled,
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

/** 底层驱动句柄：PGlite 暴露 close()，postgres.js 暴露 end()。 */
type ClosableClient = {
  end?: (opts?: { timeout?: number }) => Promise<unknown>;
  close?: () => Promise<unknown>;
};

async function closeClient(db: Database): Promise<void> {
  const raw = (db as unknown as { $client?: ClosableClient }).$client;
  try {
    if (typeof raw?.end === "function") await raw.end({ timeout: 2 });
    else if (typeof raw?.close === "function") await raw.close();
  } catch {
    // 关闭失败无所谓：连接已经不可信，进程回收时平台会一并清掉
  }
}

/**
 * 丢弃并关闭当前连接实例，下次 getDb() 重新建连。
 * 实例冻结/远端挂起后池里的连接已死但驱动仍认为可用，不重建就会一直炸。
 * 异步关闭且不 await —— 不能让重试等在一个坏连接上。
 */
export function resetDatabase(): void {
  const stale = holder.promise;
  holder.promise = undefined;
  if (!stale) return;
  void stale.then(closeClient).catch(() => undefined);
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
