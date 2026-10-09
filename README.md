# Multi Database Demo

多数据库全栈应用：Go Web/Worker、React Dashboard、双 GraphQL Schema、SSR 首页、认证/用户/店铺与队列示例。源码在主仓 projects/multi-database-demo，独立发布后本目录就是仓库根。

`cmd`、`internal`、`frontend`、`schema`、`migrations`、`webui`、AGENTS 和应用 Trellis 随发布交付。公共 Go kit、Dashboard 与 devtools 是固定版本扩展依赖；不携带主仓 packages/tools/poc/docs 或任务历史。来源提交、逐文件映射和依赖完整性见 demo-release.json；依赖升级记录见 release-dependencies.json。

## 安装与命令

基线：Linux amd64、Python 3.12、Node 24、pnpm 11.15.1。Go/Atlas/Ruff 版本及 SHA256 在 toolchain.json。Mac 原生支持另行验收。

公司 npm registry 由本目录无凭据 .npmrc 指定。若 registry 要求认证，使用运行环境或任务专属 userconfig 注入；不要把 token 写入应用 .npmrc。Codeup Go 模块需要本仓只读权限，通过任务专属 Git credential helper/netrc 或 SSH URL 映射提供，不依赖另一份 checkout。GOPRIVATE 默认为 codeup.aliyun.com/shanjing。SSH 用户可在当前 shell 设置 GIT_CONFIG_COUNT=1、GIT_CONFIG_KEY_0=url.git@codeup.aliyun.com:.insteadOf、GIT_CONFIG_VALUE_0=https://codeup.aliyun.com/ 并使用自己的 SSH agent。

在本目录执行：

```sh
pnpm install --frozen-lockfile
pnpm setup
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

覆盖率只统计本应用 cmd/internal/webui，公共包测试由主仓和包发布验收负责。生成与构建采用 GOWORK=off；主仓共享开发仍可用根 go.work。pnpm schema/schema:diff、format/format:check、clean:runtime/clean:cache/clean:all 保留。devtools 包入口复用同一生成、格式、进程监管和清理实现。Python 3.11 系统可通过 STARTER_SETUP_PYTHON 指定任务内 Python 3.12 供 setup 使用；监管使用原生 python3，要求 pidfd。

pnpm dev 先构建私有资源，再串行重载 Web/Worker，业务就绪后启动 Vite。保留同项目进程接管、其他进程保护、pidfd 身份核验、启动锁、运行租约、退出端口复查和缓存清理。公开页在 http://127.0.0.1:5173/ 与 /test/queue，后台 /admin/；直接 Go 服务默认 8080。

## Docker 与规范

Dockerfile 的上下文是本应用目录，主仓执行 `docker build -f projects/multi-database-demo/Dockerfile projects/multi-database-demo`；独立仓执行 `docker build .`。私有依赖凭据通过 BuildKit secret 注入（npmrc 和 netrc）；也可用 SSH agent 转发及任务专属 gitconfig/known_hosts secret，不复制私钥，不放入镜像层。最终 scratch 镜像分别运行 /web 与 /worker，迁移是独立步骤。

AGENTS.md 和 .trellis/spec 是应用规范。从本目录运行 `python3 .trellis/scripts/get_context.py --mode packages` 和 `python3 .trellis/scripts/task.py current --source`。本 Trellis 管应用；主仓共享包/工具/发布任务用根 Trellis。同一任务不重复建档，不继承上游身份或日志。

应用升级公共扩展时，先验收并发布新包，更新精确版本、独立 pnpm-lock.yaml 和 release-dependencies.json；Go kit 更新为经验证的 commit/pseudo-version 及 go.sum，不添加相邻目录 replace。惠购等派生项目保留自己的业务和迁移提交，只采用依赖与命令配置的增量升级。
