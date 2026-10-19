# Multi Database Demo

主仓 `multi-database-demo:dev` 保留公共 Go kit／Dashboard 的源码联调与主仓工具上下文；应用内 `dev` 使用自己的工具和固定公共依赖。

多数据库全栈应用：Go Web/Worker、React Dashboard、双 GraphQL Schema、SSR 首页、认证/用户/店铺与队列示例。源码在主仓 projects/multi-database-demo，独立发布后本目录就是仓库根。

`backend`、`frontend`、`miniprogram`、`share`、`docker`、`scripts`、AGENTS 和应用 Trellis 随发布交付。公共支持脚本与 formatter 工具白名单由导出器从同一提交交付。公共 Go kit、Dashboard 是固定版本扩展依赖；主仓发版工具和任务历史保持主仓归属。来源提交、逐文件映射和依赖完整性见 demo-release.json；依赖升级记录见 release-dependencies.json。

## 目录边界

```text
backend/          Go 模块、cmd、internal、migrations 和 gqlgen 配置
frontend/         Web 前端源码、包配置和测试
miniprogram/      应用提供的小程序源码、包配置和测试
share/schema/     共用 GraphQL SDL 与生成的目标数据库 Schema
docker/           Dockerfile 与基础／测试镜像清单
scripts/          可直接编辑的生成、开发、检查、测试与清理命令
tools/            独立导出时注入公共工具白名单（工作区复用主仓 tools）
.trellis/         应用规范与工作流
```

根目录保留 package.json、pnpm workspace／lock、toolchain、运行环境和发布清单。所有统一命令在应用根执行，工具在 backend 中运行 Go 命令。Go module 标识与原有 import 路径保持一致；主仓 go.work 指向 backend。Go 包级测试与业务文件同目录。

Docker 从应用根使用 `rtk proxy docker build -f docker/Dockerfile -t multi-database-demo .`，`.dockerignore` 留在构建上下文根。Web 前端输出到 backend/internal/web/dist，后端嵌入该目录；SSR 页面保留在 backend/internal/pages。

## 安装与命令

源码平台矩阵：Linux amd64、macOS Intel（amd64）/Apple Silicon（arm64）；Python 3.12+、Node 24、pnpm 11.15.1。toolchain.json 按平台固定 Go/Atlas/Ruff 的版本、下载地址与 SHA256。命令直接执行本应用 `scripts/*.py`，独立导出的 `tools` 提供固定 CLI 依赖锁和格式工具，应用开发重载由 `scripts/dev_reload.py` 负责。主仓使用 `pnpm multi-database-demo:dev` 等名称前缀转发，本目录使用 `pnpm dev` 等原生入口。macOS 两架构保留实机验收。

布局规范名为 `app-layout-v2`，旧 `app-only-v2` 保留为兼容别名，两者使用相同目录与环境规则；`app-only-v1` 保持历史根目录布局。应用脚本通过 starter.config.json 校验布局。

公司 npm registry 由本目录无凭据 .npmrc 指定。若 registry 要求认证，使用运行环境或任务专属 userconfig 注入；不要把 token 写入应用 .npmrc。Codeup Go 模块需要本仓只读权限，通过任务专属 Git credential helper/netrc 或 SSH URL 映射提供，不依赖另一份 checkout。GOPRIVATE 默认为 codeup.aliyun.com/shanjing。SSH 用户可在当前 shell 设置 GIT_CONFIG_COUNT=1、GIT_CONFIG_KEY_0=url.git@codeup.aliyun.com:.insteadOf、GIT_CONFIG_VALUE_0=https://codeup.aliyun.com/ 并使用自己的 SSH agent。

仓库通过 `core.sshCommand` 指定 SSH agent 时，在依赖下载命令的环境中设置同值的 `GIT_SSH_COMMAND`，Go 临时仓库将复用该认证配置。

在本目录执行：

```sh
pnpm install --frozen-lockfile
pnpm run setup
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
pnpm generate
pnpm migrate
pnpm dev
```

backend/.env 填写独立 DB/Redis/认证配置；MIGRATION_URL 可选，留空使用 DB_DSN，生产环境推荐配置独立迁移账户。迁移通过专用命令执行，构建和服务启动保持独立。默认测试包含纯单测和 SQLite；MySQL/PostgreSQL/Redis 真实集成测试需要各自隔离 TEST_DSN/REDIS_TEST_URL。

## 环境配置与统一入口

应用根保留 `pnpm dev`、`pnpm build`、`pnpm migrate` 等编排命令。`backend/.env` 与 `.env.example` 保存 DB、迁移账户、Redis、认证、Web/Worker 和后端监控配置；`frontend/.env` 与 `.env.example` 保存 `SPA_PORT` 和公开 `VITE_*` 配置。本地环境文件沿用 Git/Docker 忽略规则。

后端命令默认读取 `backend/.env`；`--env-file` 指定后端配置，`STARTER_ENV_FILE` 保持嵌套命令继承。主仓模式按仓库 `.env`、所选后端文件、进程环境依次覆盖；独立 app-layout-v2 读取所选后端文件后由进程环境覆盖。旧 app-only-v1 工具布局继续使用应用根 `.env`，选择自定义文件时按根 `.env`、所选文件、进程环境依次覆盖。

Vite 原生加载 `frontend/.env`、`.env.local`、`.env.[mode]`、`.env.[mode].local`，进程变量优先。开发启动器通过应用安装的 Vite `loadEnv` 按 development 模式读取 `SPA_PORT`，支持原生 dotenv 注释、`export`、多行值与变量展开，由后端 `WEB_ADDR` 生成 `WEB_ORIGIN`，统一用于端口检查和 Vite 代理。Vite 子进程继承筛选后的宿主工具环境、公开 `VITE_*` 与代理信息；DB、Redis、认证配置保留在后端环境。文件中的 `VITE_*` 交给 Vite 加载，保持 mode 优先级。

日常开发从应用根执行 `rtk pnpm dev`。前端目录单独启动时，在前端环境文件或进程环境提供 `WEB_ORIGIN`；缺省代理到 `http://127.0.0.1:8080`。`SPA_PORT` 的解析结果须为有效数字端口；`VITE_*` 为浏览器公开配置，变化后重新构建。

应用命令随源码发布；派生项目在自己的 package.json 与 scripts 中维护编排，后续工具改进通过定向源码补丁升级。主仓开发期间，通用脚本通过 shared_scripts.py 复用根公共实现，公共 formatter 源码维护于根 tools/cmd/format-go；独立导出从同一提交展开脚本并交付白名单 tools 源码及单测。

检查和发布构建：

```sh
pnpm check
pnpm test
pnpm test:go:coverage
pnpm build
```

`pnpm test` 在前端构建后执行 Vite 配置回归和应用 Go 测试，配置测试失败立即终止后续测试。

覆盖率只统计本应用 backend/cmd 与 backend/internal，公共包验收由主仓负责。生成与构建采用 GOWORK=off；主仓公共验收使用根 go.work。schema/schema:diff、format/format:check、clean:runtime/clean:cache/clean:all 直接执行本地脚本，工具安装和运行产物位于本应用 `.tools`、`.runtime`；Python 命令统一使用 3.12+，Linux 接管依赖 pidfd。

pnpm dev 先构建私有资源，再串行重载 Web/Worker，业务就绪后启动 Vite。Linux 保留同项目进程接管、其他进程保护、pidfd 身份核验、启动锁、运行租约、退出端口复查和缓存清理。新版工具的 macOS 适配通过 ps/lsof/sysctl 管理当前受管进程，冲突端口提示占用详情，用户手动退出旧服务后重试；检查失败保留运行产物与缓存。公开页在 http://127.0.0.1:5173/ 、/test/queue 与 /test/bus，后台 /admin/；直接 Go 服务默认 8080。

## 微信小程序

[小程序开发说明](miniprogram/README.md)覆盖独立 Taro 工程、Member Codegen、`batch-test` 单次／批量店铺查询及 WSL→Windows 产物同步。`pnpm dev:weapp` 启动 watch，`pnpm build:weapp` 生成小程序生产产物；Web 开发使用 `pnpm dev`，Web 构建继续使用 `pnpm build`。`pnpm check`、`pnpm test` 分别纳入小程序检查和 Node 回归，`pnpm codegen`／`codegen:check` 覆盖 Admin 与 Member。

小程序单独配置 `miniprogram/.env`；使用自己的 AppID、可达的 Member 端点与专用 Windows dist 目录。开发与生产均仅保留 `pages/dev/batch-test/index`，作为唯一启动页。批量测试页提供邮箱密码登录／退出，复用现有会话与 Bearer 鉴权；微信 `wx.login` 接入延期，现有认证协议与数据库保持现状。小程序产物由微信开发者工具发布，Go Docker 镜像继续承载 Web 应用。

## 认证与来源配置

`APP_MODE` 显式选择 `development`／`production`，Web 需要认证密钥和显式 `ALLOW_ORIGINS` 白名单。开发模式支持 `http://localhost:*`、`http://127.0.0.1:*`，覆盖端口 1–65535 及省略端口的默认来源；本地 HTTPS 需显式配置对应 `https://` 规则。精确来源可以与本地端口规则混用，IPv6 与其他主机使用精确来源。生产使用精确 HTTPS 来源与 Secure Cookie，启动时拒绝通配配置。

认证、CORS、GraphQL 与 WebSocket 共用来源匹配规则，跨站保护继续生效。本地端口通配将同主机的其他页面加入受信任来源，开发机仅运行可信服务；浏览器入口和 API 统一使用同一个主机名，跨 `localhost`／`127.0.0.1` 的访问需检查站点关系与 Cookie。来源配置更新后重启开发监管器；Linux 可重新运行 `pnpm dev` 接管，macOS 先退出旧服务再启动。

## Docker 与规范

Dockerfile 的上下文是本应用目录，主仓执行 `docker build -f projects/multi-database-demo/docker/Dockerfile projects/multi-database-demo`；独立仓执行 `rtk proxy docker build -f docker/Dockerfile .`。私有依赖凭据通过 BuildKit secret 注入（npmrc 和 netrc）；也可用 SSH agent 转发及任务专属 gitconfig/known_hosts secret，不复制私钥，不放入镜像层。最终 scratch 镜像分别运行 /web 与 /worker，迁移是独立步骤。

AGENTS.md 和 .trellis/spec 是应用规范。从本目录运行 `python3 .trellis/scripts/get_context.py --mode packages` 和 `python3 .trellis/scripts/task.py current --source`。本 Trellis 管应用；主仓共享包/工具/发布任务用根 Trellis。同一任务不重复建档，不继承上游身份或日志。

应用升级公共扩展时，先验收并发布新包，更新精确版本、独立 pnpm-lock.yaml 和 release-dependencies.json；Go kit 更新为经验证的 commit/pseudo-version 及 go.sum，不添加相邻目录 replace。惠购等派生项目保留自己的业务和迁移提交，只采用依赖与命令配置的增量升级。

应用 HTTP 路由与前端资源接入统一在 `backend/internal/web`（`package web`）；`frontend` 构建到 `backend/internal/web/dist`，公开 SSR 模板与渲染在 `backend/internal/pages`。

静态资源缓存随后端 `APP_MODE` 生效：`development` 对 `/admin`、`/admin/*` 与 `/public/*` 响应统一返回 `Cache-Control: no-store`；`production` 保留 `assets/*` 的一年 `immutable` 缓存及入口 HTML／固定文件名资源的 `no-cache`。API、WebSocket、SSE 保持原响应策略。浏览器已有强缓存需要一次清理或强制重新加载后取得新策略；开发监管的内嵌资源仍来自启动构建快照，前端资源更新沿用重新构建／完整重启流程。

开发监管、资源快照、macOS 平台适配与 Vite 配置测试入口由本应用脚本维护。

Go kit 固定为 `v0.0.0-20261011051254-4d1c52cf70e4`，来源为已合并的 main，包含密码校验/繁忙错误、队列 Logger 和标准 GraphQL 装配接口。Dashboard 固定正式 0.1.1，支持 Sheet 遮罩定制。版本与真实校验值见 backend/go.mod、backend/go.sum 和 release-dependencies.json；主仓工作区联调与独立 `GOWORK=off` 验收分别记录。

## 前端 GraphQL Codegen

店铺、身份、用户、会话和队列的 Admin 操作集中于应用 `frontend/src/graphql/admin/operations.ts`，生成类型位于相邻 `generated.ts`。配置直接读取应用 SDL，复用 Astro starter 的操作类型生成方式；GraphQL 请求使用 Apollo Client 与显式结果/变量泛型，普通查询由 BatchHttpLink 合并，mutation 与身份查询独立发送；保留 Cookie、取消与 ApiError 契约，REST 沿用 fetch。

```sh
rtk pnpm codegen
rtk pnpm codegen:check
```

修改 SDL 或操作后执行 `codegen`，将生成文件与源码一起提交。`codegen:check` 全程只读，支持未提交产物和无 Git 的独立应用；前端构建和类型检查会执行它。主仓 `multi-database-demo:generate` 同时更新 Go、SQL 和前端操作类型。独立应用的 `codegen` 命令覆盖 Admin 前端与 Member 小程序；生成命令实现随应用源码交付。

生成结果保留字段空值和可选输入，DateTime 映射为字符串，JSON 映射为 unknown。Admin 与 Member 按各自 SDL、操作和产物隔离。前端测试覆盖同步检查、非法操作/变量、scalar 和现有请求边界；编译期断言覆盖分页变量、必填输入和可空结果。

## 前端质量与表单工具

- `rtk pnpm lint` 执行 ESLint/TypeScript、Hooks 和 JSX 无障碍检查；`typecheck` 先运行 lint，主仓与独立应用 `check` 沿用该门禁。ESLint 固定 v9，与 jsx-a11y 当前 peer 范围保持兼容。生成的 Admin 类型由 Codegen/编译门禁校验，lint 聚焦维护源码。
- `rtk proxy pnpm --filter multi-database-demo-dashboard test` 顺序执行 Node 配置/请求/Codegen 回归及 Vitest；Vitest 使用 Testing Library、jest-dom、user-event 与 jsdom 验证组件和监控。测试统一位于 `frontend/tests`：Vitest 使用 `unit/`，Node 使用 `node/`，编译契约使用 `types/graphql/admin/type-contract.test.ts` 并纳入 TypeScript/lint 验收，DOM 初始化位于 `setup.ts`；Playwright 沿用 `tests/*.spec.ts` 并显式限定匹配范围，HMR 独立验收脚本位于 `tests/verify-hmr.mjs`。
- Zod 校验店铺创建表单的名称/slug：归整空白、按 Unicode 字符校验 1–255 长度；服务端继续承担最终输入和权限校验，GraphQL 类型继续由 SDL 生成。
- 公共 Dashboard 的时间范围控件增加中文范围日历，保留两个 `datetime-local` 输入、原有时间与浏览器本地日期语义。日历先编辑草稿，应用后更新筛选输入；查询继续由现有提交和服务端筛选驱动。

主仓使用 Dashboard 工作区源码。当前独立应用仍固定 Dashboard 0.1.0，新增日历和公共 DOM 测试随公共包新版本发布、精确依赖与锁文件更新交付；当前 registry 固定版本与工作区新增源码分别验收。

## 错误监控

监控默认关闭，空 DSN 继续沿用现有日志和错误响应。Web/Worker 运行时配置 `SENTRY_DSN`、`SENTRY_ENVIRONMENT`、`SENTRY_RELEASE`；React SPA 构建时配置 `VITE_SENTRY_DSN`、`VITE_SENTRY_ENVIRONMENT`、`VITE_SENTRY_RELEASE`。Vite 的公开变量随前端构建固化，修改后重新构建；前端 DSN 使用独立项目的公开接入地址。环境与 release 只填写公开部署标识。

Go 采集 HTTP 内部异常、直接 5xx、GraphQL 内部异常日志、Worker 执行异常和配置加载后的进程失败。React 采集错误边界、未捕获异常和请求层内部失败。认证、权限、输入校验、取消请求及 Go 公开业务错误保持静默；队列错误和 panic 保留原有重试／恢复语义。

事件采用白名单输出：固定异常消息、编译文件／Go 包定位信息、行列号、公开 release/environment，Go 额外保留合法 request_id 和固定 GraphQL 端点。请求 URL/正文/头、Cookie、用户数据、面包屑、异常原文、局部变量、上下文源码和附件均从事件中移除；性能追踪、会话跟踪、Replay 保持关闭。监控初始化或发送故障安全降级，Web/Worker 退出时最多额外等待 1 秒 flush。

Docker 构建可传 `--build-arg VITE_SENTRY_DSN=...` 等三项公开变量，服务端 DSN 在容器运行环境注入。真实 Sentry 项目送达、告警规则及 source map 上传属于独立部署验收；当前事件保留编译文件和行列，测试通过内存 transport 验证脱敏与采集。

## Bus 消息演示

访问 `/test/bus`，登录后可体验两条链路：

1. **REST + WebSocket 广播**：连接广播订阅，再发布消息；多个标签页可收到同一 messageId。
2. **REST + SSE + WebSocket 查询**：连接浏览器设备模拟器，再提交查询；每笔请求通过独立 requestId/responseKey 接收 1–3 条结果。模拟器支持成功、设备错误和超时模式，查询支持单笔取消和清空取消。

正文与链路说明由 Go SSR 输出，匿名操作显示登录入口；实时 API 沿用会话与同源校验。后端查询窗口为 5 秒，模拟器每条结果等待 200–700 毫秒。消息与记录仅保存在当前页面内存中。

浏览器专项在已迁移的隔离数据库和 Redis 环境执行（命令从应用根运行）：

```bash
rtk proxy env TEST_ORIGIN=http://127.0.0.1:8080 \
  BUS_TEST_EMAIL=bus@example.com BUS_TEST_PASSWORD=合成验收密码 \
  pnpm --dir frontend exec playwright test tests/bus.spec.ts
```

额外提供 `BUS_PEER_ORIGIN` 可验证第二个 Web 实例的查询回传；`BUS_SCREENSHOT` 指定广播页移动端截图路径。生产 TLS、Secure Cookie、真实数据库部署与容量仍按专项验收流程执行。
