"use client";

import "./globals.css";
import { ErrorState } from "@/components/common/ErrorState";

/**
 * 兜底边界：连根 layout 都挂了的时候才走到这里。
 * 它替换掉整个 html/body，所以必须自己渲染 <html>/<body>，
 * 也必须自己引 globals.css —— 根 layout 的 import 在这里不生效。
 * 此时没有路由上下文（useRouter 不可用），重试只能靠整页刷新。
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <ErrorState
          title="整本册子打不开了"
          description="应用在最外层就出了错。刷新页面通常能直接恢复；如果一直打不开，把下面的错误编号发给维护者。"
          digest={error?.digest}
          onRetry={() => window.location.reload()}
          homeHref="/"
          homeLabel="回到首页"
          seed={3}
        />
      </body>
    </html>
  );
}
