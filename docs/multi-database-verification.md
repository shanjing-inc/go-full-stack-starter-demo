# 单应用多数据库重构与验收

记录日期：2026-10-06（UTC）。工作目录：`/home/dream/wwwroot/go-starter`，分支：`develop`，实施基线：`ca17c1a`。该轮结束时源码改动保留在工作区，暂存区保持空；后续目录恢复状态见下文。

## 备份与结构

重构前的双应用实现已保存到 stash `fa0f56498d273064982825bc90b33c12225bc2a7`，说明为 `2026-10-07 multi-database-demo 重构前双应用实现备份`。独立备份位于 `/home/dream/wwwroot/go-starter/.runtime/multi-database-refactor-20261007`，包含文件清单、源码副本、tracked 补丁与本地配置备份。旧 PostgreSQL 示例忽略产物位于 `postgresql-ignored-artifacts`；旧 MySQL `tmp` 调试产物位于 `mysql-ignored-tmp`。

`projects/multi-database-demo` 统一业务应用，一份 frontend、Go module、GraphQL／Gen 代码、Web／Worker、Dockerfile；数据库差异保留为 `migrations/mysql`、`migrations/postgres`、`migrations/sqlite` 与三个目标 SQL。恢复旧方案时先备份当前工作区，再从 stash 或 `previous-source` 选择性提取所需文件；完整恢复应使用独立工作目录。stash 保持保留。

## 配置与兼容性

当前 MySQL／PostgreSQL 共用应用 `.env` 与 `.env.example`，数据库类型由 `DB_DSN` 的 URL 协议推导，`postgresql://` 归一为 PostgreSQL。根 `.env`、应用配置、进程变量依次覆盖，嵌套构建通过 `STARTER_ENV_FILE` 继承配置路径，`--env-file` 支持验收与部署指定配置。迁移与 schema diff 校验运行连接、迁移连接与开发库的数据库类型一致。下方早期验收记录保留当次源码与配置快照。

早期目录重构中，MySQL 用户 `.env` 随目录移动，原内容及哈希保持一致，数据库与 Redis namespace 保留。MySQL／SQLite 历史迁移、checksum、生成 SQL、核心 GraphQL SDL 已逐字节核对原 HEAD。旧临时调试源文件已移入备份，避免 Go 包扫描加载旧 module 引用。

PostgreSQL 使用 18+ 与 ICU，初始迁移检查主版本，非确定性 Unicode 排序规则支持邮箱／slug 等价和 LIKE；角色匹配采用 C 排序规则。时间采用 timestamptz 与 UTC，revision 表位于 public。迁移账户、受限 Web 与只读 Worker 在隔离验收中验证。

## 验收记录

- 改名基线：MySQL／SQLite 独立源码快照验收通过 16 项；开发与浏览器按当次参数跳过。报告：`/home/dream/wwwroot/go-starter/.runtime/project-cbrxh4s_/result.json`。
- 最终 `pnpm test`、`pnpm check` 通过：Go 单测、脚本回归、Dashboard 54 项单测、Go vet、前端类型检查、前端构建与全仓库格式检查。日志：`/home/dream/wwwroot/go-starter/.runtime/multi-database-refactor-20261007/final-test.log`、`/home/dream/wwwroot/go-starter/.runtime/multi-database-refactor-20261007/final-check.log`。
- MySQL／SQLite 宿主机验收 `pnpm verify --skip-browser`：17 项通过，浏览器按参数跳过；Go 通过记录 512。开发专项包含 Vite／Web／Worker 冷启动、并行隔离、代际指纹、公共源码热更新、编译失败恢复与统一退出。报告：`/home/dream/wwwroot/go-starter/.runtime/project-t65en6_t/result.json`。
- MySQL 内嵌 SPA 浏览器：167／167 通过，失败、flaky 与 skipped 均为 0。报告：`/home/dream/wwwroot/go-starter/.runtime/project-3s8cnr_s/browser.json`。该次完整 `pnpm verify` 的开发模式浏览器阶段触发 240 秒 timeout，整轮状态为 failed；保留超时记录与后续专项通过记录。报告：`/home/dream/wwwroot/go-starter/.runtime/project-3s8cnr_s/result.json`。
- MySQL Docker 运行阶段 `pnpm verify:docker --runtime-only`：13／13 通过，`cleanupErrors=[]`。报告：`/home/dream/wwwroot/go-starter/.runtime/project-docker-runtime-result.json`。完整构建与 MySQL／Redis 容器拓扑由后续完整 Docker 验收覆盖。
- MySQL 完整 Docker `pnpm verify:docker --build-proxy http://127.0.0.1:7897 --pull-timeout 300`：14／14 通过，真实 MySQL 8.0.46，覆盖基础镜像拉取与摘要、正式多阶段构建、MySQL／Redis 容器拓扑和运行行为，`cleanupErrors=[]`。报告：`/home/dream/wwwroot/go-starter/.runtime/project-docker-result.json`。
- PostgreSQL Docker 运行阶段加浏览器 `pnpm verify:postgresql:browser`：15／15 通过，真实 PostgreSQL 18.6，Go 通过记录 193，10 个关键集成测试实际通过且所选 Go 套件零 skip；浏览器 167／167 通过，失败、flaky 与 skipped 均为 0，`cleanupErrors=[]`。报告：`/home/dream/wwwroot/go-starter/.runtime/project-postgresql-docker-runtime-result.json`。
- PostgreSQL 完整 Docker `pnpm verify:postgresql:docker --build-proxy http://127.0.0.1:7897 --pull-timeout 300`：15／15 通过，覆盖基础镜像拉取与摘要、正式多阶段构建、隔离数据库／Redis、受限账户、双 Web／Worker、REST／GraphQL、队列、实时协议、readiness／启动门禁及 SIGTERM，`cleanupErrors=[]`。报告：`/home/dream/wwwroot/go-starter/.runtime/project-postgresql-docker-result.json`。浏览器由上述独立运行阶段覆盖。

最终兼容性核对：原应用 132 个 tracked 文件全部落入统一应用；MySQL／SQLite 迁移、checksum、生成 SQL 与 GraphQL SDL 共 12 个文件逐字节一致；用户 MySQL `.env` 哈希保持一致，该轮结束时 stash 保留且暂存区为空。记录：`/home/dream/wwwroot/go-starter/.runtime/multi-database-refactor-20261007/final-compatibility-review.json`。三方言通过 `pnpm schema` 再次生成并确认结果哈希一致；记录：`/home/dream/wwwroot/go-starter/.runtime/multi-database-refactor-20261007/final-schema-hashes.json`。

该轮验收结束时容器与网络已清理，8080／5173 端口保持空闲。

本轮日志目录为 `/home/dream/wwwroot/go-starter/.runtime/multi-database-refactor-20261007`。默认单测中外部数据库 fixture 测试按缺少 DSN 跳过；真实验收按数据库选择并确认对应集成用例实际通过。

## 独立发布验收边界

生产 TLS／反向代理／Secure Cookie、真实旧库切换、容量与发布验证保留专项验收；跨数据库完整 Unicode 排序等价与旧库时间解释继续按实际数据核对。race 保留专项验收，当前测试工具链使用 `CGO_ENABLED=0`。

Schema 审查延续既有认证契约：表名、认证主键、布尔字段、既有索引命名、`session`／`account` 外键级联保持兼容；金额／结算场景本轮未涉及。业务唯一标识与邮箱等价由唯一索引约束，外键关联列类型一致；认证表字段注释与 MySQL 通用表规范的历史差异随原结构保留。MySQL 历史 DDL 保持原字节，PostgreSQL 新增独立迁移与目标 SQL。

## 本地 PostgreSQL 开发

统一配置位于 `/home/dream/wwwroot/go-starter/projects/multi-database-demo/.env`，示例位于同目录 `.env.example`。填写 PostgreSQL `DB_DSN`、独立迁移账户 `MIGRATION_URL`、Redis、`AUTH_SECRET` 与首位 owner 初始化密钥；MySQL 切换时同步替换两个数据库连接 URL。

```bash
cd /home/dream/wwwroot/go-starter
# 初次配置时复制 .env.example；现有 .env 保留现用参数
rtk proxy cp projects/multi-database-demo/.env.example projects/multi-database-demo/.env
# 编辑 .env，保留 APP_MODE=development 并填写连接和密钥
rtk pnpm migrate
rtk pnpm dev
```

## 2026-10-07 目录名称恢复

为集中审查双数据库功能，应用目录恢复为 `projects/go-mysql-demo`，Go module、imports、代码生成配置、pnpm workspace、脚本与 Docker 引用同步恢复，后台展示名称沿用 `Go MySQL Demo`。MySQL／PostgreSQL 支持、独立配置、迁移、回归测试与验收入口保持保留；目录名称调整留待后续独立改动。

本次操作开始时已有 188 个文件处于暂存状态，工作区与暂存区一致。原暂存补丁、Git index 与本地配置哈希已保存到 `/home/dream/wwwroot/go-starter/.runtime/demo-name-restore-20261007-101045`；恢复名称后同步原暂存范围，commit／push 保持由用户授权。

本地配置文件随目录移动，内容保持原样。PostgreSQL 历史迁移与 checksum 保持原字节，其中初始迁移的旧应用名称提示按历史记录保留；MySQL／SQLite 历史迁移、目标 SQL 与 GraphQL SDL 继续按基线核对。以前记录中的独立验收目录和报告保留当时的快照。

本次 `pnpm install --frozen-lockfile --offline`、`pnpm generate`、`pnpm test`、`pnpm check` 通过。代码生成后的 Go module、GraphQL／Gen 核心文件、Dockerfile、workspace 与 lockfile 已核对基线；历史迁移、目标 SQL 与 SDL 共 12 个文件及本地配置哈希保持一致。日志位于上述目录；数据库与容器完整验收记录对应前一轮源码快照。

## 2026-10-07 统一连接 URL 配置

应用目录继续保持 `projects/go-mysql-demo`，默认配置统一为 `.env` 与 `.env.example`。开发、迁移与 schema diff 使用通用命令，独立数据库验收入口继续保留；验收的数据库选择参数用于建立隔离依赖。

Go 的 `database.ParseDSN` 负责协议识别与原生 DSN 转换，Python 使用同一份 URL 合约样本验证识别规则。MySQL 支持默认端口、IPv6、百分号编码凭据与连接参数；PostgreSQL 保留原 URL；SQLite 转换绝对／相对文件路径与内存连接。错误文案隐藏账户、密码与原始 URL。

原 MySQL／PostgreSQL 本地配置和原 Git 暂存补丁已备份至 `/home/dream/wwwroot/go-starter/.runtime/dsn-config-refactor-20261007-111724`。现用 PostgreSQL 配置合并到应用 `.env`，原有认证密钥、连接参数和 namespace 保持原值，旧 PostgreSQL 配置文件已归入备份。历史迁移、checksum、目标 SQL 与 GraphQL SDL 共 16 个文件保持原字节。上述完整数据库与 Docker 记录仍对应各自历史源码快照。

本轮验证：

- `pnpm format`、`pnpm generate`、`pnpm test`、`pnpm check` 通过；Go／Python 共用 42 个连接 URL 合约样本，Dashboard 54／54 单测通过。最终格式、测试和检查日志位于上述备份目录。
- MySQL／SQLite 独立源码快照验收 `pnpm verify --skip-browser --skip-dev`：16 项通过，Go 通过记录 560，涵盖真实 MySQL／Redis 集成、正式迁移、受限账户、双 Web／Worker、认证、REST／GraphQL、实时通信、队列、readiness 与优雅退出。浏览器与开发／HMR 专项按参数跳过。报告：`/home/dream/wwwroot/go-starter/.runtime/project-gm4feonl/result.json`。
- PostgreSQL Docker 运行阶段验收 `pnpm verify:postgresql`：14／14 通过，真实 PostgreSQL 18.6，Go 通过记录 237，`cleanupErrors=[]`。覆盖正式迁移、真实 PostgreSQL 集成、受限 Web／只读 Worker 账户、双 Web／Worker、认证、REST／GraphQL、实时通信、队列、readiness／启动门禁与优雅退出。报告：`/home/dream/wwwroot/go-starter/.runtime/project-postgresql-docker-runtime-result.json`。
- 使用通用 `pnpm dev` 恢复现用 PostgreSQL 开发服务，Web／Worker 状态为 `ready`。8080 首页、8080／5173 后台页面均返回 200；两端未登录 GraphQL 请求均返回 401，Vite 代理与后端权限响应一致。记录：`/home/dream/wwwroot/go-starter/.runtime/dsn-config-refactor-20261007-111724/development-smoke.json`。

本轮浏览器、完整多阶段 Docker 构建、race 与生产 TLS／反向代理／Secure Cookie、真实旧库切换、容量／发布验收保留专项覆盖。原 44 个文件的暂存补丁与 HEAD 保持原样，本轮新增实现保留在工作区；提交和推送继续由用户授权。

## 2026-10-07 审查问题修复

PostgreSQL `schema:diff` 自动移除 `ATLAS_DEV_URL` 中的 `search_path`，使用数据库级开发库完成目标状态加载、迁移重放和自定义排序规则清理。开发库的全部 schema 均可被清空，连接需使用专门隔离库。运行连接与正式迁移连接继续保留各自的 `search_path`；既有迁移、checksum 与目标 SQL 保持原字节。

缺省 `.env` 路径仅在文件存在时写入 `STARTER_ENV_FILE`；显式指定路径保持继承和缺失检查。无 `.env`、无 `DB_DSN` 的生成／构建环境可持续传入嵌套命令，根目录配置加载与进程环境优先级保持原有规则。

新增回归覆盖缺省配置下的嵌套环境、显式配置优先级、PostgreSQL URL 别名与参数保留，以及真实 schema diff：连续两次零漂移、新增 ICU 文本列迁移生成、生成迁移重放后零漂移。真实 diff 使用验收专属数据库与迁移／目标 SQL 副本，生成物留在独立验收目录。

本轮 `pnpm test`、`pnpm check` 通过，Dashboard 54／54；配置入口专项 17／17、PostgreSQL 验收脚本专项 10／10、Docker 验收脚本专项 44／44。`pnpm verify:postgresql` 15／15 通过，包含新增真实 schema diff，`cleanupErrors=[]`。报告：`/home/dream/wwwroot/go-starter/.runtime/project-docker-rxudj6c9/result.json`。

缺省配置真实回归：移除仓库／应用 `.env` 并清除继承的 `DB_DSN`，在独立源码快照运行 `pnpm verify --skip-browser --skip-dev`，16 项通过、2 项按参数跳过，Go 通过记录 560。覆盖嵌套代码生成、构建及真实 MySQL／SQLite／Redis 流程。报告副本：`/home/dream/wwwroot/go-starter/.runtime/fix-fresh-checkout-result.json`。初次双层快照路径触发 MySQL Unix socket 的 107 字节长度限制；短路径 `/tmp/go-fix-6i105jy8` 重跑通过，原始失败日志保留在 `/home/dream/wwwroot/go-starter/.runtime/fix-fresh-checkout-plviwfcw/verification.log`。

最终 ICU 排序规则断言另以真实 PostgreSQL 开发库重跑 schema diff 专项通过，`cleanupErrors=[]`；报告：`/home/dream/wwwroot/go-starter/.runtime/project-docker-g1ju1u4r/schema-diff-result.json`。本轮浏览器／开发 HMR、race、完整多阶段 Docker 构建及生产专项保持各自验收边界，修复保留在工作区，原暂存区保持一致。

## 2026-10-07 示例应用名称调整

以 `d25d621` 为基线，将应用目录改为 `projects/multi-database-demo`，Go module、imports、GraphQL／Gen 生成配置、pnpm workspace／lockfile、Dockerfile、开发／验收脚本与当前代码路径同步更新。后台标题与页面 title 改为 `Multi Database Demo`，侧栏与 HMR 验收使用相同名称。上文目录恢复及连接配置记录保留各轮历史名称与证据。

工程目录与后台展示名称使用 `multi-database-demo`／`Multi Database Demo`。数据库名由连接 URL 决定；默认 `APP_NAMESPACE=go-mysql-demo` 沿用既有 Redis 队列、幂等与调度数据。浏览器偏好键沿用 `go-mysql-demo`，主题与字号继续读取既有设置。现用 `.env` 随目录移动并保持内容，历史迁移、checksum、目标 SQL 和 GraphQL SDL 保持原字节。

新增工程名称一致性、默认／显式 Redis namespace 与浏览器页面标题回归。备份和本轮验证日志位于 `/home/dream/wwwroot/go-starter/.runtime/demo-rename-20261007-130714`。

### 名称调整验收结果

- `pnpm install --frozen-lockfile --offline`、`pnpm generate`、`pnpm test` 与 `pnpm check` 通过；Dashboard 单测 54／54，覆盖 Go 单测、脚本回归、Go vet、前端类型检查、构建与项目格式检查。
- MySQL／SQLite 独立源码快照验收 `pnpm verify --skip-browser --skip-dev`：16 项通过，浏览器与开发编排 2 项按参数跳过，Go 通过记录 561。覆盖真实迁移、受限账户、双 Web／独立 Worker、认证、REST／GraphQL、队列、实时协议、启动门禁及优雅退出。报告：`/home/dream/wwwroot/go-starter/.runtime/project-rbik0669/result.json`。
- 嵌入式后台 Mock 浏览器套件 157／157，Vite 的偏好／侧栏／会话专项 47／47；两套失败、flaky、skipped 均为 0。测试使用 Mock API，开发库数据保持原样。报告：`/home/dream/wwwroot/go-starter/.runtime/demo-rename-20261007-130714/browser-embedded-final.json` 与 `browser-vite-final.json`。
- 首次嵌入式浏览器运行发现移动侧栏字号 fixture 使用了新名称偏好键，已改回兼容键，并增加 sidebar／preferences fixture 一致性回归；上述结果来自修复后的完整重跑。
- 开发服务按现用 `.env` 恢复，8080／5173 后台显示新名称，首页／后台 HTTP 200，未登录 GraphQL 401。公共 Dashboard HMR 在 Mock API 环境通过，主题与 18px 字号使用原偏好键读取成功，热更新保持页面状态。报告：`/home/dream/wwwroot/go-starter/.runtime/demo-rename-20261007-130714/development-smoke.json`、`hmr-smoke.json`。任务完成时保留开发服务运行。
- 配置、三类数据库历史迁移／checksum／目标 SQL、GraphQL SDL 等共 19 个保护文件的 SHA-256 与改名前备份一致。真实 `.env`、依赖、构建与运行产物均按现有忽略规则排除。
- `pnpm verify:postgresql --browser` 已通过当前源码构建、最终 scratch 运行镜像构建及非 root／默认 Web 入口／SIGTERM 元数据检查；隔离 PostgreSQL／Redis 容器阶段因本机缺少固定摘要的 PostgreSQL 18 镜像而处于 blocked，退出码 2，`cleanupErrors=[]`。日志：`/home/dream/wwwroot/go-starter/.runtime/demo-rename-20261007-130714/postgresql-browser.log`；报告：`/home/dream/wwwroot/go-starter/.runtime/project-postgresql-docker-runtime-result.json`。

本轮全开发编排、真实业务浏览器、完整多阶段 Docker、race 与生产 TLS／反向代理／Secure Cookie／旧库切换／容量验收保留专项覆盖。名称调整保留在工作区，真实暂存区保持空，HEAD 为 `d25d621`。
