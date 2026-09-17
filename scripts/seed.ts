import "dotenv/config";

import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runMigrations } from "@/lib/db/migrate";
import { createEntry } from "@/lib/entry/entry.service";
import { today } from "@/lib/utils/date";

/**
 * 演示数据：npm run db:seed -- --login-id me
 * 造两周的记录，用于验证时间线、日历热力与复盘的输入是否成形。
 */

const SAMPLES: Array<{ daysAgo: number; time: string; content: string; tags: string[] }> = [
  { daysAgo: 0, time: "08:20", content: "早上去河边走了一圈，风很凉。 #日常", tags: ["日常"] },
  { daysAgo: 0, time: "13:05", content: "中午把上周没看完的书翻完了，结尾比开头好。 #阅读", tags: ["阅读"] },
  { daysAgo: 1, time: "21:40", content: "今天写代码写得很顺，一个下午解决掉三个卡了很久的问题。 #工作", tags: ["工作"] },
  { daysAgo: 2, time: "19:12", content: "和朋友吃了顿很久没吃的火锅，聊到店铺打烊。 #朋友", tags: ["朋友"] },
  { daysAgo: 3, time: "07:50", content: "下雨了，通勤路上堵了四十分钟，反而把播客听完了。", tags: [] },
  { daysAgo: 4, time: "22:05", content: "开始练字，第一页写得很难看，但手是热的。 #习惯", tags: ["习惯"] },
  { daysAgo: 6, time: "15:30", content: "把阳台的花换了个位置，希望能多晒到太阳。", tags: [] },
  { daysAgo: 8, time: "20:00", content: "试着早起第三天，还是有点困，但早上的时间真的变多了。 #习惯", tags: ["习惯"] },
  { daysAgo: 10, time: "12:10", content: "妈妈打电话来，说家里下雪了。", tags: [] },
  { daysAgo: 12, time: "18:45", content: "整理旧照片，翻到一张六年前的海边。 #回忆", tags: ["回忆"] },
  { daysAgo: 14, time: "09:00", content: "决定了下个月的目标：把那件事真正做完，而不是一直准备。 #目标", tags: ["目标"] },
];

function arg(name: string, fallback = ""): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return fallback;
}

function shiftDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  await runMigrations();

  const loginId = arg("login-id") || "me";
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.loginId, loginId)).limit(1);
  const user = rows[0];
  if (!user) {
    console.error(`找不到账号 ${loginId}，请先执行 npm run bootstrap`);
    process.exit(1);
  }

  const ctx = { userId: user.id, timezone: user.timezone, preferences: { autoAnnotate: false } };
  const todayStr = today(user.timezone);

  for (const s of SAMPLES) {
    await createEntry(ctx, {
      content: s.content,
      entryDate: shiftDays(todayStr, s.daysAgo),
      occurredTime: s.time,
      ...(s.tags.length ? { tags: s.tags } : {}),
      source: "import",
    });
  }

  console.log(`已写入 ${SAMPLES.length} 条演示记录（账号 ${loginId}）。`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
