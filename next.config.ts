import type { NextConfig } from "next";

const securityHeaders = [
  // CSP 由 middleware.ts 按请求注入 nonce（放这里会让 Next 无法注入，导致白屏）
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pino", "cos-nodejs-sdk-v5", "@electric-sql/pglite"],
  experimental: {
    // 上传路由接收本地驱动的文件字节，其余路由保持默认
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
