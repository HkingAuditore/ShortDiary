import "dotenv/config";

import { getDb } from "@/lib/db/client";
import { entries, jobs } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

/**
 * 一次性修复：清理僵尸 pending。
 * createEntry 曾在 autoAnnotate=false（如 seed、导入）时仍写 ai_status='pending' 却不入队，
 * 这些记录永远显示「AI 整理中」。规则：pending 且 jobs 表里没有任何 ai_annotate 任务
 * 引用该记录 → 落为 skipped。有任务的（无论成败）交给 worker 正常流转。
 *
 * 注意：不用 raw SQL 子查询 —— PGlite WASM 对 jsonb 子查询 UPDATE 会直接 Aborted()，
 * 全部走 drizzle 基础操作 + JS 层差集。
 *
 * 用法：npx tsx scripts/fix-zombie-pending.ts
 */

async function main() {
  const db = await getDb();

  const pendingRows = await db
    .select({ id: entries.id })
    .from(entries)
    .where(eq(entries.aiStatus, "pending"));
  if (pendingRows.length === 0) {
    console.log("没有 pending 记录，无需修复。");
    return;
  }

  const jobRows = await db
    .select({ entryId: jobs.payload })
    .from(jobs)
    .where(eq(jobs.type, "ai_annotate"));
  const referenced = new Set<string>();
  for (const row of jobRows) {
    const payload = row.entryId as { entryId?: string } | null;
    if (payload?.entryId) referenced.add(payload.entryId);
  }

  const zombieIds = pendingRows.map((r) => r.id).filter((id) => !referenced.has(id));
  if (zombieIds.length === 0) {
    console.log(`${pendingRows.length} 条 pending 全部有对应任务，无需修复。`);
    return;
  }

  await db
    .update(entries)
    .set({ aiStatus: "skipped" })
    .where(and(inArray(entries.id, zombieIds), eq(entries.aiStatus, "pending")));

  console.log(`已修复 ${zombieIds.length} 条僵尸 pending → skipped。`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
