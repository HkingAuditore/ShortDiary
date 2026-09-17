import type { Database } from "./client";

/**
 * 仓储层统一的执行器类型。事务内外使用同一套接口，
 * 让 service 层可以把多步写入包在一个事务里而不改变 repo 的签名。
 */
export type DbExecutor = Database;
