import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@/lib/crypto/envelope";

/**
 * Auth.js v5 + Credentials + JWT session strategy。
 * JWT 策略下每次请求 0 次 DB 查询即可拿到 user_id，消除鉴权这一最高频查询；
 * 不引入 adapter，避免 edge runtime 兼容问题。
 */

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "账号密码",
      credentials: {
        loginId: { label: "账号", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const loginId = String(credentials?.loginId ?? "").trim();
        const password = String(credentials?.password ?? "");
        // 凭证错误必须 return null（v5 约定）：next-auth 会转成标准的
        // CredentialsSignin → ?error=CredentialsSignin。若在这里 throw AppError，
        // v5 会归类为 error=Configuration（"配置错误"），语义全错。
        if (!loginId || !password) return null;

        const db = await getDb();
        const rows = await db.select().from(users).where(eq(users.loginId, loginId)).limit(1);
        const user = rows[0];
        if (!user || !verifyPassword(password, user.passwordHash)) return null;
        return { id: user.id, name: user.displayName, email: user.email ?? undefined };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (typeof token.uid === "string") {
        session.user.id = token.uid;
      }
      return session;
    },
  },
});
