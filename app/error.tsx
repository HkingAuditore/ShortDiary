"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ErrorState } from "@/components/common/ErrorState";

/**
 * 根段错误边界：兜住 `/`（根页）、(auth) 与 (app) 两个 layout 自身的异常。
 * (app) 各页面有自己的边界，会先被它们接住，这里只处理漏网的。
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <main className="min-h-screen">
      <ErrorState
        title="这一页没能铺开"
        description="服务端取数据的时候出了岔子，通常是数据库连接临时抖了一下。你写下的东西都还在，没有丢。"
        digest={error?.digest}
        // reset() 只重渲客户端边界，router.refresh() 才会重新拉服务端数据——
        // 服务端渲染抛的错必须两者都做，否则点了没反应。
        onRetry={() => startTransition(() => { router.refresh(); reset(); })}
        retrying={pending}
      />
    </main>
  );
}
