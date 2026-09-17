"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { PaperButton, PaperCard } from "@/components/paper/PaperCard";
import { useToast } from "@/components/common/Toast";

export function LoginForm() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await signIn("credentials", { loginId, password, redirect: false });
      if (res?.error) {
        toast.push("账号或密码不正确", { tone: "error" });
      } else {
        window.location.href = "/timeline";
      }
    } catch {
      toast.push("登录失败，请稍后重试", { tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <PaperCard seed="login" className="w-full max-w-sm p-6">
      <h1 className="font-(--font-serif-cn) text-xl tracking-wide">剪纸日记</h1>
      <p className="mt-1 text-sm text-ink-muted">像发消息一样记下日常，再像手账一样留住它们。</p>

      <form className="mt-5 flex flex-col gap-3" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-muted">账号</span>
          <input
            className="paper-focus rounded-[3px] border border-ink/15 bg-paper-strong px-3 py-2"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-muted">密码</span>
          <input
            type="password"
            className="paper-focus rounded-[3px] border border-ink/15 bg-paper-strong px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <PaperButton type="submit" variant="primary" disabled={pending} className="mt-1">
          {pending ? "正在进入…" : "进入"}
        </PaperButton>
      </form>
    </PaperCard>
  );
}
