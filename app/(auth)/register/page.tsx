import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guard";
import { RegisterForm } from "./RegisterForm";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getSessionUser();
  if (user) redirect("/timeline");

  return (
    <main className="paper-login-stage flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* 桌面底部山形剪影：低对比度氛围层（简洁模式下自动隐藏） */}
      <div aria-hidden className="paper-hills pointer-events-none absolute inset-x-0 bottom-0 h-40" />
      <RegisterForm />
    </main>
  );
}
