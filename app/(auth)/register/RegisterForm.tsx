"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { PaperButton, PaperCard, HandNote } from "@/components/paper/PaperCard";
import { useToast } from "@/components/common/Toast";
import { apiSend, ApiError } from "@/lib/api/client";

const INPUT_CLASS =
  "paper-focus rounded-[4px] border border-ink/15 bg-paper-strong px-3 py-2 shadow-[inset_0_1px_2px_rgba(76,58,39,0.06)] outline-none transition-[border-color] duration-(--dur-fast) focus:border-sage/60";

export function RegisterForm() {
  const [code, setCode] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.push("两次输入的密码不一致", { tone: "error" });
      return;
    }
    setPending(true);
    try {
      await apiSend("/api/auth/register", "POST", {
        code: code.trim(),
        loginId: loginId.trim(),
        password,
      });

      // 注册成功直接进入（next-auth 的 signIn 内部自带 csrf 处理）
      const res = await signIn("credentials", { loginId: loginId.trim(), password, redirect: false });
      if (res?.error) {
        toast.push("注册成功，但自动登录失败，请手动登录", { tone: "info" });
        window.location.href = "/login";
      } else {
        toast.push("欢迎来到剪纸日记", { tone: "success" });
        window.location.href = "/timeline";
      }
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "注册失败，请稍后重试", { tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative w-full max-w-sm">
      {/* 三层叠纸背景：与登录页同一套视觉语言 */}
      <span aria-hidden className="absolute -left-5 -top-6 h-full w-full rotate-[-3deg] rounded-[6px] bg-sun/40 shadow-(--shadow-paper)" />
      <span aria-hidden className="absolute -left-2.5 -top-3 h-full w-full rotate-[2deg] rounded-[6px] bg-rose/35 shadow-(--shadow-paper)" />

      <PaperCard seed="register" className="relative p-7">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="relative inline-flex h-10 w-10 items-center justify-center">
            <span className="absolute inset-0 rotate-[6deg] rounded-[4px] bg-sun/70" />
            <span className="absolute inset-0 -rotate-[5deg] rounded-[4px] bg-rose/70" />
            <span className="relative flex h-8 w-8 items-center justify-center rounded-[4px] bg-paper-strong text-lg shadow-[0_2px_6px_rgba(76,58,39,0.25)] font-(--font-serif-cn)">
              剪
            </span>
          </span>
          <h1 className="font-(--font-serif-cn) text-xl tracking-wide">开启新的一页</h1>
        </div>
        <HandNote className="mt-2 block">凭邀请码领取你的抽屉，写下的每页都只属于你。</HandNote>

        <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-muted">邀请码</span>
            <input
              className={INPUT_CLASS}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              placeholder="一码一人，用过即止"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-muted">账号</span>
            <input
              className={INPUT_CLASS}
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              autoComplete="username"
              placeholder="字母、数字、下划线或连字符"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-muted">密码</span>
            <input
              type="password"
              className={INPUT_CLASS}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="至少 8 位"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-muted">确认密码</span>
            <input
              type="password"
              className={INPUT_CLASS}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          <PaperButton type="submit" variant="primary" disabled={pending} className="mt-2 py-2.5">
            {pending ? "正在领取…" : "领取我的抽屉"}
          </PaperButton>
        </form>

        <div className="mt-5 flex items-center justify-between text-[11px] text-ink-faint">
          <span className="hand-note">已有账号？</span>
          <a className="paper-focus underline decoration-sage/50 underline-offset-2 transition-colors hover:text-ink" href="/login">
            直接登录
          </a>
        </div>
      </PaperCard>
    </div>
  );
}
