import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";

/**
 * 【临时诊断路由】排查 EdgeOne 部署上 auth() 拿不到会话的问题。
 * 只输出布尔值/长度/请求头，不泄露任何密钥内容。定位完成后删除。
 */
export async function GET() {
  const h = await headers();
  let session: unknown = null;
  let authError: string | null = null;
  try {
    session = await auth();
  } catch (e) {
    authError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  return Response.json({
    ts: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV ?? null,
      hasAUTH_SECRET: !!process.env.AUTH_SECRET,
      authSecretLength: (process.env.AUTH_SECRET ?? "").length,
      hasNEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
      AUTH_URL: process.env.AUTH_URL ?? null,
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? null,
      hasAPP_MASTER_KEY: !!process.env.APP_MASTER_KEY,
      hasDATABASE_URL: !!process.env.DATABASE_URL,
    },
    requestHeaders: {
      "x-forwarded-proto": h.get("x-forwarded-proto"),
      host: h.get("host"),
      "x-forwarded-host": h.get("x-forwarded-host"),
      cookieNames: (h.get("cookie") ?? "")
        .split(";")
        .map((c) => c.trim().split("=")[0])
        .filter(Boolean),
    },
    authResult: {
      sessionUser: (session as { user?: unknown } | null)?.user ?? null,
      error: authError,
    },
  });
}
