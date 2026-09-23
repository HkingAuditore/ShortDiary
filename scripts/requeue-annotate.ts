import "dotenv/config";

import { getDb } from "@/lib/db/client";
import { entries, jobs } from "@/lib/db/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { ServiceContext } from "@/lib/entry/entry.service";

/**
 * 重新排队所有未完成的 AI 整理任务。
 * 适用场景：更换 Provider API key 后，把之前失败/耗尽重试的记录全部重新整理。
 *
 * 注意：PGlite 是单进程模型，必须先停掉 dev server 再跑本脚本，跑完再启动。
 *
 * 用法：npx tsx scripts/requeue-annotate.ts
 */
async function main() {
  const db = await getDb();

  // 1) 找出所有未成功整理的记录（failed / 耗尽重试卡住的）
  const pendingRows = await db
    .select({ id: entries.id, userId: entries.userId, aiStatus: entries.aiStatus })
    .from(entries)
    .where(inArray(entries.aiStatus, ["pending", "failed", "queued", "running"]));
  console.log(`待重新整理的记录：${pendingRows.length} 条`);

  if (pendingRows.length === 0) {
    console.log("没有需要处理的记录。");
    return;
  }

  // 2) 删掉旧的 ai_annotate 任务行（幂等键会挡住重新入队，必须先删）
  await db.delete(jobs).where(and(eq(jobs.type, "ai_annotate"), ne(jobs.status, "succeeded")));
  console.log("已清理旧任务行");

  // 3) 逐条重新入队（沿用 createEntry 的幂等键格式）
  for (const row of pendingRows) {
    await db.insert(jobs).values({
      id: randomUUID(),
      type: "ai_annotate",
      payload: { entryId: row.id, userId: row.userId },
      idempotencyKey: `annotate:${row.id}`,
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      runAfter: new Date(),
    });
    await db.update(entries).set({ aiStatus: "queued" }).where(eq(entries.id, row.id));
  }
  console.log(`已重新入队 ${pendingRows.length} 条，启动 dev server 后会自动开始整理。`);
}

// ServiceContext 仅用于类型引用提示（与 entry.service 的 payload 结构一致），无实际调用
void (null as unknown as ServiceContext);

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
