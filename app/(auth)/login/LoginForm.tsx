"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { PaperButton, PaperCard, HandNote } from "@/components/paper/PaperCard";
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
    <div className="relative w-full max-w-sm">
      {/* 三层叠纸背景：进入应用前先闻到纸味 */}
      <span aria-hidden className="absolute -left-5 -top-6 h-full w-full rotate-[-3deg] rounded-[6px] bg-sun/40 shadow-(--shadow-paper)" />
      <span aria-hidden className="absolute -left-2.5 -top-3 h-full w-full rotate-[2deg] rounded-[6px] bg-rose/35 shadow-(--shadow-paper)" />

      <PaperCard seed="login" className="relative p-7">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="relative inline-flex h-10 w-10 items-center justify-center">
            <span className="absolute inset-0 rotate-[6deg] rounded-[4px] bg-sun/70" />
            <span className="absolute inset-0 -rotate-[5deg] rounded-[4px] bg-rose/70" />
            <span className="relative flex h-8 w-8 items-center justify-center rounded-[4px] bg-paper-strong text-lg shadow-[0_2px_6px_rgba(76,58,39,0.25)] font-(--font-serif-cn)">
              剪
            </span>
          </span>
          <h1 className="font-(--font-serif-cn) text-xl tracking-wide">剪纸日记</h1>
        </div>
        <HandNote className="mt-2 block">像发消息一样记下日常，再像手账一样留住它们。</HandNote>

        <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-muted">账号</span>
            <input
              className="paper-focus rounded-[4px] border border-ink/15 bg-paper-strong px-3 py-2 shadow-[inset_0_1px_2px_rgba(76,58,39,0.06)] outline-none transition-[border-color] duration-(--dur-fast) focus:border-sage/60"
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
              className="paper-focus rounded-[4px] border border-ink/15 bg-paper-strong px-3 py-2 shadow-[inset_0_1px_2px_rgba(76,58,39,0.06)] outline-none transition-[border-color] duration-(--dur-fast) focus:border-sage/60"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <PaperButton type="submit" variant="primary" disabled={pending} className="mt-2 py-2.5">
            {pending ? "正在进入…" : "进入"}
          </PaperButton>
        </form>

        <div className="mt-5 flex items-center justify-between text-[11px] text-ink-faint">
          <span className="hand-note">每一页都收在你的抽屉里</span>
          <a className="paper-focus underline decoration-sage/50 underline-offset-2 transition-colors hover:text-ink" href="/register">
            有邀请码？注册
          </a>
        </div>
      </PaperCard>
    </div>
  );
}
