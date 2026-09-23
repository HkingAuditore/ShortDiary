# 剪纸日记

像发消息一样记下日常，再像手账一样留住它们。
**随手记录 → 自动整理 → AI 复盘 → 长期回忆** 的闭环，数据始终是你的。

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Next.js 15（App Router）+ React 19 | 首屏 RSC 直出，后续交互走客户端 |
| 语言 | TypeScript strict（`noUncheckedIndexedAccess` / `verbatimModuleSyntax`） | 编译期挡住一整类空值错误 |
| 数据 | Drizzle ORM + postgres.js | 未配置 `DATABASE_URL` 时自动回退到内置 PGlite（WASM Postgres） |
| 鉴权 | Auth.js v5 Credentials + JWT 会话 | 每次请求 0 次 DB 查询即可拿到 user_id |
| AI | 自建 Gateway（OpenAI 兼容 / Anthropic / Gemini） | BYOK，密钥 AES-256-GCM 信封加密 |
| 任务 | Postgres 表队列 + `FOR UPDATE SKIP LOCKED` | 不引入 Redis，单机即可跑；自托管进程内轮询，无服务器平台外部触发 |
| 存储 | 腾讯云 COS（签名的直传/直读）或本地磁盘 | 由 `COS_*` 是否配置自动选择 |
| 样式 | Tailwind CSS 4 `@theme` token | 组件不写死色值 |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量（本地已生成一份 .env；若不存在则复制模板）
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # APP_MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # AUTH_SECRET

# 3. （可选）起一个真 Postgres；留空则用内置 PGlite
docker compose up -d postgres
# DATABASE_URL=postgres://journal:journal@localhost:5432/journal

# 4. 建表 + 建号 + 演示数据
npm run db:migrate
npm run bootstrap -- --login-id me --password your-password
npm run db:seed -- --login-id me

# 5. 启动
npm run dev          # http://localhost:3000
```

生产：

```bash
npm run build && npm start
```

## 关键设计

- **多用户隔离从第一天就有**：所有仓储函数的第一个形参是 `userId`；Zod 在边界剥掉客户端传来的 `user_id`；API 只从 JWT 取身份。单人部署也保持这个约束，将来开放注册不用返工。
- **游标分页，禁止 OFFSET**：游标是 `entryDate|createdAt|id` 的 base64url，配合 `(user_id, entry_date DESC, created_at DESC, id DESC)` 索引。
- **时间线单查询**：一次查询 + `LEFT JOIN LATERAL json_agg`，条目 / 图片 / 标签 / AI 摘要一次拿全，避免 1+30×3 的 N+1。
- **AI 永不阻塞写入**：创建记录立刻返回，整理与复盘都进后台任务队列；AI 失败只影响增强字段，不碰正文。
- **图片不经过应用服务器**：压缩与 blurhash 在 Worker 里做，字节直传对象存储；`width/height` 入库用于 `aspect-ratio` 占位，CLS≈0。
- **导出即用**：ZIP 由 `node:zlib` 手写（零额外依赖），带冻结的 `schema_version` 清单，可再导入、幂等。

## 目录

```
app/(auth)        登录
app/(app)         应用外壳：时间线 / 日历 / 相册 / 复盘 / 搜索 / 设置
app/api           Route Handlers（统一信封、requestId、限流）
lib/db            schema / client / 迁移 / 聚合查询
lib/entry         记录：repo → service → mapper → schema
lib/ai            Gateway、三个协议适配器、prompt 与输出校验、缓存、熔断
lib/jobs          队列与 Worker（annotate / review / gc）
lib/storage       COS 与本地磁盘双驱动
lib/export        ZIP 打包与导入
drizzle/          按序号排列的 SQL 迁移（人工审阅，禁止 db push）
```

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` / `npm start` | 生产构建与启动 |
| `npm run typecheck` | TypeScript 严格检查 |
| `npm run lint` | ESLint |
| `npm run db:generate` | 由 schema 生成迁移 SQL |
| `npm run db:migrate` | 执行迁移 |
| `npm run db:check` | 校验数据库实际列与 Drizzle schema 是否一致 |
| `npm run bootstrap` | 建号 / 改口令 |
| `npm run db:seed` | 写入演示数据 |
| `bash scripts/smoke.sh` | 服务起来后的端到端冒烟（健康检查 / 登录 / 记录 CRUD / 游标翻页 / 导出下载） |

冒烟默认打 `http://127.0.0.1:3000`、账号 `me`：

```bash
npm run build && npm start &
bash scripts/smoke.sh http://127.0.0.1:3000 me demo1234
```

> 在 WorkBuddy 的沙箱终端里跑 `bash scripts/smoke.sh` 会全部 000——沙箱只放行
> bash 的直接子进程发起的网络请求，脚本里的 curl 属于孙进程。改用
> `source scripts/smoke.sh` 即可（脚本在当前 shell 内执行，curl 变回直接子进程）。
> 普通（非沙箱）终端不受影响，`bash scripts/smoke.sh` 照常可用。

### CSP 与内联脚本（勿回退）

CSP 由 `middleware.ts` 按请求注入 nonce（Next 从请求头的
`Content-Security-Policy` 里提取 nonce 并加到它渲染的每个 script 上）。
**不要**把 CSP 挪回 `next.config.ts` 的静态 headers——静态头无法注入 nonce，
Next 的内联引导脚本会被全部拦截，水合失败，表现为整页空白。

配套注意：`instrumentation.ts` 里 Node 专属模块的动态 import 必须写在
`if (process.env.NEXT_RUNTIME === "nodejs") { ... }` 分支**内部**。
一旦项目有 middleware，Next 会把 instrumentation 也编进 edge bundle；
写成「先 return 再 import」时 webpack 在解析阶段仍会去解析那些模块
（死代码消除发生在优化阶段），导致 `Can't resolve 'stream'` 之类的构建失败。

## 环境变量

见 `.env.example`。要点：

- `APP_MASTER_KEY` 必须 32 字节 base64，用于加密 AI Provider 的 API Key，**绝不落库、绝不返回前端**。
- `DATABASE_URL` 留空即用 PGlite 本地文件库（零依赖开发）。
- `COS_*` 全部留空即回退本地磁盘存储驱动。
- `JOB_WORKER_MODE=external` + `JOB_TICK_SECRET=<长随机串>`：无服务器平台的任务模式（见下节）。

### 无服务器平台部署（EdgeOne Pages 等）

进程内 `setInterval` 轮询在实例会冻结的无服务器平台上不可靠（EdgeOne Pages Node Functions：
请求 body ≤ 6MB、单次执行默认 30s 墙钟、无请求时实例冻结）。任务队列改由
**外部调度打 `POST /api/jobs/tick`** 驱动：

1. 平台环境变量里配置：

   ```
   JOB_WORKER_MODE=external
   JOB_TICK_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   ```

2. **外部 cron（主力，分钟级）**，任选其一每分钟（或每 5 分钟）触发：

   ```bash
   curl -s -X POST "https://<域名>/api/jobs/tick" \
     -H "Authorization: Bearer <JOB_TICK_SECRET>"
   ```

   - GitHub Actions `schedule`（免费，最短 5 分钟，实际有数分钟抖动）
   - cron-job.org（免费，支持分钟级，只支持 GET 时用 `?secret=<JOB_TICK_SECRET>`）
   - 自有服务器 crontab

3. **平台 schedules（小时级兜底）**：仓库根目录的 `edgeone.json` 声明了每小时触发
   `/api/jobs/tick` 的定时任务。部署前把其中 `payload.secret` 的占位符替换为
   `JOB_TICK_SECRET` 的值（平台 payload 无法读环境变量，只能静态填写）。
   外部 cron 挂掉时任务最多延迟一小时被兜底捞起。

   > 注：EdgeOne 文档称 schedules 的 cron「最小间隔一天」，但官方速查表又列出每小时表达式；
   > 若平台拒绝每小时调度，把 `edgeone.json` 的 cron 降为每日即可，主力始终是外部 cron。

4. **写日记后的即时处理**：入队点仍会 `kickWorker()`（进程内 fire-and-forget drain）。
   实例温热时任务立即执行；进程中途被冻结的话任务会停在 running——
   下一次 tick 的 `requeueStuckJobs`（2 分钟阈值）会自动回收重跑，annotate 是幂等覆盖写，无副作用。

鉴权方式三选一：`Authorization: Bearer <secret>` 头（推荐）、JSON body `{"secret": ...}`
（EdgeOne schedules 的 payload 走这里）、`?secret=` query（仅供只支持 GET 的 cron 服务，
会进访问日志）。响应返回本次领取/成功/失败/回收的统计。

自托管 / 本地开发完全不受影响：`JOB_WORKER_MODE` 不配置即默认 `inprocess`，行为与从前一致。

### 本地开发注意（PGlite）

PGlite 是**单进程独占** `.data/pgdata` 的：跑 `db:migrate` / `bootstrap` / `db:seed` 这些脚本前，
必须先把 `npm run dev` 或 `npm start` 停掉，否则脚本会卡住或拿不到锁。
配了 `DATABASE_URL`（真 Postgres）就没有这个限制。
