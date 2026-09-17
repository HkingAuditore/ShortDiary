/**
 * 进程启动钩子（Next.js instrumentation）：
 * - 补齐数据库 schema
 * - 启动后台任务轮询器（AI 整理 / 复盘 / 孤儿回收）
 *
 * 关键：这些模块依赖 node:fs / cos-nodejs-sdk-v5 等 Node 内置能力。
 * 一旦项目存在 middleware，Next 会把 instrumentation 也编进 edge bundle，
 * 所以必须把 import 写在 `if (process.env.NEXT_RUNTIME === "nodejs")` 分支**内部**——
 * webpack 在解析阶段就会跳过整条死分支；写成「先 return 再 import」是无效的，
 * 死代码消除发生在优化阶段，那时模块解析已经失败。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSchema } = await import("./lib/db/migrate");
    const { startWorker } = await import("./lib/jobs/runner");

    try {
      await ensureSchema();
    } catch (err) {
      console.error("[startup] 数据库 schema 初始化失败：", err);
    }

    try {
      startWorker();
    } catch (err) {
      console.error("[startup] 任务轮询启动失败：", err);
    }
  }
}
