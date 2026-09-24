import "dotenv/config";
import { getDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";

/**
 * 任务队列体检 / 清理。
 *
 * 三类病灶，症状都是「界面卡在 AI 整理中，永远不动」：
 * 1. stuck    —— status=running 但很久没更新：平台把函数杀了，任务永远回不到队列
 * 2. zombie   —— status=queued 但 attempts >= max_attempts：claimNext 永远不再领它
 * 3. orphan   —— entry 还挂着 pending/queued/running，但队列里已经没有它的有效任务
 *
 * 默认只体检不写入；确认无误后加 --apply 执行处置。
 *
 * 用法：
 *   npx tsx scripts/jobs-doctor.ts            # 只报告
 *   npx tsx scripts/jobs-doctor.ts --apply    # 报告并清理
 */

/** 超过这个分钟数还停在 running，就认定执行进程已经死了 */
const STUCK_MINUTES = 10;
/** entry 挂在生成中超过这个分钟数且没有有效任务，就认定它永远不会再有人处理 */
const ORPHAN_MINUTES = 10;

const APPLY = process.argv.includes("--apply");

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybe = result as { rows?: unknown[] };
  return (maybe?.rows ?? []) as Record<string, unknown>[];
}

async function main() {
  const db = await getDb();

  // 1) 卡死的 running 任务
  const stuck = rowsOf(
    await db.execute(sql`
      select id, type, attempts, max_attempts, created_at, updated_at, payload
      from jobs
      where status = 'running' and updated_at < now() - ${`${STUCK_MINUTES} minutes`}::interval
      order by updated_at asc
    `),
  );
  console.log(`\n[1/3] 卡死的 running 任务：${stuck.length} 条`);
  for (const j of stuck) {
    console.log(`  ${j.type} attempts=${j.attempts}/${j.max_attempts} updated=${String(j.updated_at).slice(0, 19)} ${JSON.stringify(j.payload)}`);
  }

  // 2) 重试次数耗尽的僵尸任务
  const zombie = rowsOf(
    await db.execute(sql`
      select id, type, attempts, max_attempts, created_at, last_error
      from jobs
      where status = 'queued' and attempts >= max_attempts
      order by created_at asc
    `),
  );
  console.log(`\n[2/3] 重试耗尽的僵尸任务：${zombie.length} 条`);
  for (const j of zombie) {
    console.log(`  ${j.type} attempts=${j.attempts}/${j.max_attempts} created=${String(j.created_at).slice(0, 19)} err=${String(j.last_error ?? "").slice(0, 50)}`);
  }

  // 3) 没有任何有效任务、却还挂着「生成中」的记录
  const orphan = rowsOf(
    await db.execute(sql`
      select e.id, e.ai_status, e.content, e.updated_at
      from entries e
      where e.deleted_at is null
        and e.ai_status in ('pending', 'queued', 'running')
        and e.updated_at < now() - ${`${ORPHAN_MINUTES} minutes`}::interval
        and not exists (
          select 1 from jobs j
          where j.type = 'ai_annotate'
            and j.payload->>'entryId' = e.id::text
            and j.status in ('queued', 'running')
            and j.attempts < j.max_attempts
        )
      order by e.updated_at asc
    `),
  );
  console.log(`\n[3/3] 没人再处理的「生成中」记录：${orphan.length} 条`);
  for (const e of orphan) {
    console.log(`  ${String(e.ai_status).padEnd(8)} updated=${String(e.updated_at).slice(0, 19)} ${String(e.content).slice(0, 24)}`);
  }

  if (!APPLY) {
    console.log("\n（只体检。确认后加 --apply 执行清理）");
    return;
  }

  console.log("\n== 执行清理 ==");

  const stuckIds = stuck.map((j) => String(j.id));
  if (stuckIds.length > 0) {
    // 卡死的复盘任务同时把 reviews 记录标为失败，否则界面会一直显示「生成中」
    const reviewUserIds = stuck
      .filter((j) => j.type === "review_generate")
      .map((j) => String((j.payload as Record<string, unknown>)?.userId ?? ""))
      .filter(Boolean);
    const reviewDates = stuck
      .filter((j) => j.type === "review_generate")
      .map((j) => String((j.payload as Record<string, unknown>)?.startDate ?? ""))
      .filter(Boolean);

    for (const id of stuckIds) {
      const affected = rowsOf(
        await db.execute(sql`
          update jobs set status = 'dead', last_error = '执行进程已死（任务停在 running 超时），由 jobs-doctor 下线', updated_at = now()
          where id = ${id} and status = 'running'
          returning id
        `),
      );
      console.log(`  任务下线 ${id}: ${affected.length} 行`);
    }

    if (reviewUserIds.length > 0 && reviewDates.length > 0) {
      const fixed = rowsOf(
        await db.execute(sql`
          update reviews set status = 'failed', content_json = '{"error":"生成任务卡死，已下线，可重新生成"}'::jsonb, updated_at = now()
          where user_id = any(${sql`array[${sql.join(reviewUserIds.map((u) => sql`${u}::uuid`), sql`, `)}]`})
            and start_date = any(${sql`array[${sql.join(reviewDates.map((d) => sql`${d}::date`), sql`, `)}]`})
            and status = 'pending'
          returning id
        `),
      );
      console.log(`  复盘记录标记失败：${fixed.length} 条`);
    }
  }

  const zombieIds = zombie.map((j) => String(j.id));
  if (zombieIds.length > 0) {
    const killed = rowsOf(
      await db.execute(sql`
        update jobs set status = 'dead', last_error = '重试次数耗尽仍留在队列，由 jobs-doctor 下线', updated_at = now()
        where status = 'queued' and attempts >= max_attempts
        returning id
      `),
    );
    console.log(`  僵尸任务下线：${killed.length} 条`);
  }

  const orphanIds = orphan.map((e) => String(e.id));
  if (orphanIds.length > 0) {
    const fixed = rowsOf(
      await db.execute(sql`
        update entries set ai_status = 'failed', updated_at = now()
        where id = any(${sql`array[${sql.join(orphanIds.map((i) => sql`${i}::uuid`), sql`, `)}]`})
          and ai_status in ('pending', 'queued', 'running')
        returning id
      `),
    );
    console.log(`  无人处理的记录改为 failed：${fixed.length} 条`);
  }

  console.log("\n完成。");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(String(err).slice(0, 400));
    process.exit(1);
  },
);
