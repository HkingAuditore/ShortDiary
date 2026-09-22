import "dotenv/config";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { inviteCodes, users } from "@/lib/db/schema";
import { uuidv7 } from "@/lib/utils/uuid";
import { randomInt } from "node:crypto";

/**
 * 生成邀请码：npm run invite -- --count 3 --days 14 --by me
 * - count：生成几个（默认 1）
 * - days：有效天数（默认 30，0 表示永不过期）
 * - by：生成者账号（仅作审计标记）
 */

function arg(name: string, fallback = ""): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return process.env[`INVITE_${name.toUpperCase()}`] ?? fallback;
}

/** 与注册输入一致的字符集：去掉 0/O、1/l/I 等易混淆字符 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function genCode(len = 8): string {
  let out = "";
  for (let i = 0; i < len; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

async function main() {
  const count = Math.min(Math.max(Number(arg("count", "1")) || 1, 1), 20);
  const days = Number(arg("days", "30")) || 0;
  const byLoginId = arg("by", "me");

  const db = await getDb();
  const owner = (await db.select().from(users).where(eq(users.loginId, byLoginId)).limit(1))[0];
  if (!owner) {
    console.error(`生成者账号不存在：${byLoginId}`);
    process.exit(1);
  }

  const expiresAt = days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) codes.push(genCode());

  await db.insert(inviteCodes).values(
    codes.map((code) => ({
      id: uuidv7(),
      code,
      createdBy: owner.id,
      expiresAt,
    })),
  );

  console.log(`已生成 ${count} 个邀请码（${days > 0 ? `${days} 天内有效` : "永不过期"}，一码一人）：`);
  for (const c of codes) console.log(`  ${c}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
