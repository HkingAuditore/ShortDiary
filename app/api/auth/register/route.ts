import type { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineRoute } from "@/lib/api/route";
import { getDb } from "@/lib/db/client";
import { inviteCodes, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/crypto/envelope";
import { uuidv7 } from "@/lib/utils/uuid";
import { AppError } from "@/lib/errors/app-error";

export const dynamic = "force-dynamic";

const registerSchema = z.object({
  code: z.string().trim().min(4).max(64),
  loginId: z
    .string()
    .trim()
    .min(2, "账号至少 2 个字符")
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, "账号只能包含字母、数字、下划线和连字符"),
  password: z.string().min(8, "密码至少 8 位").max(128),
  displayName: z.string().trim().min(1).max(32).optional(),
});

/** 邀请码注册：一码一人。事务内 FOR UPDATE 抢码，并发提交同一码只有一个能成功。 */
export const POST = defineRoute(
  async (req: NextRequest) => {
    const body = registerSchema.parse(await req.json());
    const db = await getDb();

    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, body.code))
        .for("update")
        .limit(1);
      const invite = rows[0];
      if (!invite) throw new AppError("INVALID_INPUT", "邀请码不存在");
      if (invite.usedBy) throw new AppError("CONFLICT", "这个邀请码已经被使用过了");
      if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
        throw new AppError("INVALID_INPUT", "邀请码已过期");
      }

      const dup = await tx.select({ id: users.id }).from(users).where(eq(users.loginId, body.loginId)).limit(1);
      if (dup[0]) throw new AppError("CONFLICT", "这个账号已经被占用了");

      const id = uuidv7();
      await tx.insert(users).values({
        id,
        loginId: body.loginId,
        passwordHash: hashPassword(body.password),
        displayName: body.displayName ?? body.loginId,
        timezone: "Asia/Shanghai",
        preferences: {},
      });
      await tx
        .update(inviteCodes)
        .set({ usedBy: id, usedAt: new Date() })
        .where(eq(inviteCodes.id, invite.id));

      return { loginId: body.loginId, displayName: body.displayName ?? body.loginId };
    });

    return { data: result, status: 201 };
  },
  // 注册是公开端点，限流防撞码：每分钟每 IP 10 次
  { rateLimit: { limit: 10 } },
);
