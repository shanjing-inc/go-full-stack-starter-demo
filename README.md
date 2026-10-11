# Multi Database Demo

多数据库全栈应用：Go Web/Worker、React Dashboard、双 GraphQL Schema、SSR 首页、认证/用户/店铺与队列示例。源码在主仓 projects/multi-database-demo，独立发布后本目录就是仓库根。

`cmd`、`internal`、`frontend`、`schema`、`migrations`、AGENTS 和应用 Trellis 随发布交付。公共 Go kit、Dashboard 与 devtools 是固定版本扩展依赖；不携带主仓 packages/tools/poc/docs 或任务历史。来源提交、逐文件映射和依赖完整性见 demo-release.json；依赖升级记录见 release-dependencies.json。

## 安装与命令

源码平台矩阵：Linux amd64、macOS Intel（amd64）/Apple Silicon（arm64）；Python 3.12+、Node 24、pnpm 11.15.1。toolchain.json 按平台固定 Go/Atlas/Ruff 的版本、下载地址与 SHA256。应用固定已正式发布的 devtools 0.1.1，包含 macOS 工具适配；macOS 两架构完整原生运行仍保留实机验收。

公司 npm registry 由本目录无凭据 .npmrc 指定。若 registry 要求认证，使用运行环境或任务专属 userconfig 注入；不要把 token 写入应用 .npmrc。Codeup Go 模块需要本仓只读权限，通过任务专属 Git credential helper/netrc 或 SSH URL 映射提供，不依赖另一份 checkout。GOPRIVATE 默认为 codeup.aliyun.com/shanjing。SSH 用户可在当前 shell 设置 GIT_CONFIG_COUNT=1、GIT_CONFIG_KEY_0=url.git@codeup.aliyun.com:.insteadOf、GIT_CONFIG_VALUE_0=https://codeup.aliyun.com/ 并使用自己的 SSH agent。

仓库通过 `core.sshCommand` 指定 SSH agent 时，在依赖下载命令的环境中设置同值的 `GIT_SSH_COMMAND`，Go 临时仓库将复用该认证配置。

在本目录执行：

```sh
pnpm install --frozen-lockfile
pnpm run setup
cp .env.example .env
pnpm generate
pnpm migrate
pnpm dev
```

.env 填写独立 DB/Redis/认证配置；迁移使用独立 MIGRATION_URL，不在构建或服务启动时自动执行。默认测试包含纯单测和 SQLite；MySQL/PostgreSQL/Redis 真实集成测试需要各自隔离 TEST_DSN/REDIS_TEST_URL。

检查和发布构建：

```sh
pnpm check
pnpm test
pnpm test:go:coverage
pnpm build
```

`pnpm test` 在前端构建后执行 Vite 配置回归和应用 Go 测试，配置测试失败立即终止后续测试。

覆盖率只统计本应用 cmd/internal，公共包测试由主仓和包发布验收负责。生成与构建采用 GOWORK=off；主仓共享开发仍可用根 go.work。pnpm schema/schema:diff、format/format:check、clean:runtime/clean:cache/clean:all 保留。devtools 包入口复用同一生成、格式、进程监管和清理实现。Python 3.11 系统可通过 STARTER_SETUP_PYTHON 指定任务内 Python 3.12 供 setup 使用；所有开发命令的 python3 统一使用 3.12+；Linux 接管依赖 pidfd。

pnpm dev 先构建私有资源，再串行重载 Web/Worker，业务就绪后启动 Vite。Linux 保留同项目进程接管、其他进程保护、pidfd 身份核验、启动锁、运行租约、退出端口复查和缓存清理。新版工具的 macOS 适配通过 ps/lsof/sysctl 管理当前受管进程，冲突端口提示占用详情，用户手动退出旧服务后重试；检查失败保留运行产物与缓存。公开页在 http://127.0.0.1:5173/ 与 /test/queue，后台 /admin/；直接 Go 服务默认 8080。

## 认证与来源配置

`APP_MODE` 显式选择 `development`／`production`，Web 需要认证密钥和显式 `ALLOW_ORIGINS` 白名单。开发模式支持 `http://localhost:*`、`http://127.0.0.1:*`，覆盖端口 1–65535 及省略端口的默认来源；本地 HTTPS 需显式配置对应 `https://` 规则。精确来源可以与本地端口规则混用，IPv6 与其他主机使用精确来源。生产使用精确 HTTPS 来源与 Secure Cookie，启动时拒绝通配配置。

认证、CORS、GraphQL 与 WebSocket 共用来源匹配规则，跨站保护继续生效。本地端口通配将同主机的其他页面加入受信任来源，开发机仅运行可信服务；浏览器入口和 API 统一使用同一个主机名，跨 `localhost`／`127.0.0.1` 的访问需检查站点关系与 Cookie。来源配置更新后重启开发监管器；Linux 可重新运行 `pnpm dev` 接管，macOS 先退出旧服务再启动。

## Docker 与规范

Dockerfile 的上下文是本应用目录，主仓执行 `docker build -f projects/multi-database-demo/Dockerfile projects/multi-database-demo`；独立仓执行 `docker build .`。私有依赖凭据通过 BuildKit secret 注入（npmrc 和 netrc）；也可用 SSH agent 转发及任务专属 gitconfig/known_hosts secret，不复制私钥，不放入镜像层。最终 scratch 镜像分别运行 /web 与 /worker，迁移是独立步骤。

AGENTS.md 和 .trellis/spec 是应用规范。从本目录运行 `python3 .trellis/scripts/get_context.py --mode packages` 和 `python3 .trellis/scripts/task.py current --source`。本 Trellis 管应用；主仓共享包/工具/发布任务用根 Trellis。同一任务不重复建档，不继承上游身份或日志。

应用升级公共扩展时，先验收并发布新包，更新精确版本、独立 pnpm-lock.yaml 和 release-dependencies.json；Go kit 更新为经验证的 commit/pseudo-version 及 go.sum，不添加相邻目录 replace。惠购等派生项目保留自己的业务和迁移提交，只采用依赖与命令配置的增量升级。

应用 HTTP 路由与前端资源接入统一在 `internal/web`（`package web`）；`frontend` 构建到 `internal/web/dist`，公开 SSR 模板与渲染在 `internal/pages`。

devtools 0.1.1 已正式发布，涵盖 `internal/web/dist` 资源快照、macOS 工具适配与 Vite 配置测试入口。应用精确依赖、锁文件、minimumReleaseAgeExclude 与 release-dependencies.json 同步记录真实 registry 版本及完整性；独立应用通过常规安装取得同一正式包。

Go kit 固定为 `v0.0.0-20261009054620-e402060eb491`，包含应用使用的 `auth.Config.Development` 字段与 `transport/origin` 包。版本与真实校验值见 go.mod/go.sum 和 release-dependencies.json；主仓工作区联调与独立 `GOWORK=off` 验收分别记录。

## 前端 GraphQL Codegen

店铺、身份、用户、会话和队列的 Admin 操作集中于应用 `frontend/src/graphql/admin/operations.ts`，生成类型位于相邻 `generated.ts`。配置直接读取应用 SDL，复用 Astro starter 的操作类型生成方式；请求继续使用现有 fetch 和显式结果/变量泛型。

```sh
rtk pnpm codegen
rtk pnpm codegen:check
```

修改 SDL 或操作后执行 `codegen`，将生成文件与源码一起提交。`codegen:check` 全程只读，支持未提交产物和无 Git 的独立应用；前端构建和类型检查会执行它。主仓 `generate` 同时更新 Go、SQL 和前端操作类型。独立应用的 `codegen` 命令直接调用应用前端；其 devtools 全生成入口的正式分发跟随工具新版本发布。

生成结果保留字段空值和可选输入，DateTime 映射为字符串，JSON 映射为 unknown。Admin 与 Member 按各自 SDL、操作和产物隔离。前端测试覆盖同步检查、非法操作/变量、scalar 和现有请求边界；编译期断言覆盖分页变量、必填输入和可空结果。
