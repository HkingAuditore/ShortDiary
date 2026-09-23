/**
 * 一次性验证脚本：external 模式任务 tick 的核心逻辑（跑在独立 PGlite 测试库上）。
 * 用法：PGLITE_DATA_DIR=.data/pgdata-tick-verify npx tsx scripts/verify-external-tick.ts
 * 验证后删除测试目录。
 */
import { getDb } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/migrate";
import { enqueue } from "@/lib/jobs/queue";
import { runExternalTick } from "@/lib/jobs/runner";
import { jobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

async function insertStuckRunningJob(): Promise<string> {
  const db = await getDb();
  const id = randomUUID();
  await db.insert(jobs).values({
    id,
    type: "export",
    payload: {},
    idempotencyKey: `stuck:${id}`,
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    // updated_at 设为 5 分钟前：超过 requeueStuckJobs(2) 的回收阈值
    runAfter: new Date(Date.now() - 5 * 60_000),
    updatedAt: new Date(Date.now() - 5 * 60_000),
  });
  return id;
}

async function main() {
  console.log("[1] 建表...");
  await ensureSchema();

  console.log("[2] 插入测试任务：export（应成功）/ ai_annotate（应失败入 dead）/ running 卡死 5 分钟（应被回收）");
  const { id: exportId } = await enqueue({ type: "export", payload: {}, idempotencyKey: "tick-verify-export" });
  // ai_annotate 缺 entryId/userId 时 handler 直接 throw（annotate.ts 首行校验）；
  // maxAttempts=2，budget 内经历两次失败 → dead
  await enqueue({
    type: "ai_annotate",
    payload: {},
    idempotencyKey: "tick-verify-annotate",
    maxAttempts: 2,
  });
  const stuckId = await insertStuckRunningJob();

  console.log("[3] runExternalTick(budgetMs=8000)...");
  const stats = await runExternalTick({ budgetMs: 8_000 });
  console.log("    stats =", JSON.stringify(stats, null, 2));

  const db = await getDb();
  const readStatus = async (key: string) => {
    const rows = await db.select({ id: jobs.id, status: jobs.status, attempts: jobs.attempts, lastError: jobs.lastError }).from(jobs).where(eq(jobs.idempotencyKey, key)).limit(1);
    return rows[0];
  };

  const exportJob = await readStatus("tick-verify-export");
  const annotateJob = await readStatus("tick-verify-annotate");
  const stuckJob = (await db.select().from(jobs).where(eq(jobs.id, stuckId)).limit(1))[0];

  console.log("[4] 断言：");
  const checks: Array<[string, boolean]> = [
    ["export 任务 succeeded", exportJob?.status === "succeeded"],
    ["卡死任务被回收（requeued >= 1）", stats.requeued >= 1],
    ["卡死任务重新执行后 succeeded", stuckJob?.status === "succeeded"],
    ["annotate 任务已失败（dead 或 queued 重试中）", annotateJob?.status === "dead" || annotateJob?.status === "queued"],
    ["annotate 任务有错误详情", Boolean(annotateJob?.lastError)],
    ["claimed >= 2（export + annotate 至少各一次）", stats.claimed >= 2],
    ["succeeded >= 2（export 一次 + 回收的卡死任务一次）", stats.succeeded >= 2],
  ];
  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) allOk = false;
  }
  if (annotateJob) console.log(`    annotate 最终状态: ${annotateJob.status}, attempts=${annotateJob.attempts}, lastError=${(annotateJob.lastError ?? "").slice(0, 80)}`);

  console.log(allOk ? "\n全部通过 ✓" : "\n存在失败断言 ✗");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
