"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ErrorState } from "@/components/common/ErrorState";

/**
 * 应用段错误边界：挂在 (app)/layout 之内，所以左侧导航和底部导航都还在，
 * 用户不必「退回登录页」才能重试。
 */
export default function AppSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <ErrorState
      title="这张纸没能写好"
      description="读取内容时服务抽了一下。导航还在，可以直接重试，也可以先去别的页看看。"
      digest={error?.digest}
      onRetry={() => startTransition(() => { router.refresh(); reset(); })}
      retrying={pending}
      seed={13}
    />
  );
}
