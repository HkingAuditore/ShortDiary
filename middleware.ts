import { NextRequest, NextResponse } from "next/server";

/**
 * CSP 必须走 middleware 而不是 next.config headers()：
 * 静态 header 是渲染完成后才附上的，Next 无法据此给内联引导脚本注入 nonce，
 * 结果所有 inline script 被拦截，页面无法水合（白屏）。
 * Next 检测到「请求头」里有 CSP 时，会自动把 nonce 加到自己渲染的 script 上。
 */

const BASE_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
];

export function middleware(request: NextRequest) {
  // Edge runtime 有 crypto.randomUUID；用 btoa 而不是 Buffer（edge 不保证 Buffer 存在）
  const nonce = btoa(crypto.randomUUID());

  // strict-dynamic：带 nonce 的引导脚本动态加载的 chunk 视为可信，无需 unsafe-inline
  // unsafe-eval 只留给 dev（HMR 需要），生产收紧掉
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(process.env.NODE_ENV !== "production" ? ["'unsafe-eval'"] : []),
  ].join(" ");

  const csp = [`script-src ${scriptSrc}`, ...BASE_DIRECTIVES].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // 静态资源不需要 nonce
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
