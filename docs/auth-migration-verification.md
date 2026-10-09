# R0／R1 邮箱认证迁移验收

验收日期：2026-10-04。工作目录：`/home/dream/wwwroot/go-starter`，分支：`feature/email-auth-migration`。

R0 兼容矩阵与 R1 核心邮箱认证已完成本地验收。手机号登录、短信、手机号绑定及新增相关字段保持延期；完整权限与用户管理按 R2 推进。本批次提交状态以 Git 历史为准，远程推送另行授权。

当前密码策略（2026-10-05）：初始化与创建用户统一为 8–128 UTF-8 字节，登录保持 512 字节上限。下文 12–128 字节为历史验收口径；当前验证见 `/home/dream/wwwroot/go-starter/docs/user-management-verification.md`。

## 本次审查修复完整验收（2026-10-04）

命令：`rtk pnpm verify`，完整执行浏览器、宿主机开发与 HMR 阶段。报告：`/home/dream/wwwroot/go-starter/.runtime/project-x243wasc/result.json`；最近结果入口：`/home/dream/wwwroot/go-starter/.runtime/project-latest.json`。

| 检查项                  | 结果                                                       |
| ----------------------- | ---------------------------------------------------------- |
| 流程检查                | 18 项通过                                                  |
| Go 测试通过记录         | 289 条，包含父用例、子用例及各阶段记录                     |
| 公共 auth 测试          | 17 个顶层用例通过，含真实 MySQL 与 Redis；父子记录共 56 条 |
| 执行的 Go 用例跳过      | 0；独立 Web 故障用例在专门阶段执行                         |
| 验收脚本回归            | 5 项通过，覆盖版本目录、认证头、Origin 和限流 key 隔离     |
| 内嵌 SPA 浏览器         | 17／17 通过，零跳过、失败与 flaky                          |
| 宿主机 Vite 开发浏览器  | 17／17 通过，零跳过、失败与 flaky                          |
| 公共 Dashboard 单测     | 7／7 通过                                                  |
| 公共 Dashboard 源码 HMR | 通过，窗口标记保留，整页刷新次数为 0                       |
| 全流程耗时              | 172.69 秒                                                  |
| Docker／race detector   | 环境待验收                                                 |

本次修复及证据：

1. **旧多字节密码**：登录最大 512 个 UTF-8 字节，新密码设置继续采用 12–128 字节。固定 Node fixture 验证 50／128 个汉字与 64 个 emoji，SQLite／真实 MySQL／HTTP 登录覆盖原散列；前端六项认证回归包含完整传递旧输入和 513 字节拒绝。请求大小、scrypt 并发与共享 Redis 限流门禁保持。
2. **组合角色**：统一 `HasRole` 和双方言管理员存在查询，覆盖首／尾／中间位置 owner／admin、重复角色、NULL、子串与大小写边界；Installed、事务锁内初始化检查、Guard 和 Dashboard 权限使用同一契约。真实 Web 使用 `owner,user` 验证初始化入口关闭及跨实例管理员访问。
3. **完整验收流程**：动态读取双方言全部迁移版本及最新 head，检查双方言迁移登记；独立认证测试库、受限账户认证表 CRUD、随机认证密钥、真实初始化／登录、Cookie／Bearer 权限和退出撤销后继续执行 GraphQL／REST／Worker／实时故障及两组浏览器。显式运行模式、错误版本和缺失迁移拒绝启动，合法 production 配置 Web／Worker 通过本地启动与优雅退出检查。

两个原样 overlay 复现均通过，日志：`/home/dream/wwwroot/go-starter/.runtime/review-fixes/auth-compatibility-retest.log`。静态浏览器报告：`/home/dream/wwwroot/go-starter/.runtime/project-x243wasc/browser.json`；开发浏览器报告：`/home/dream/wwwroot/go-starter/.runtime/project-x243wasc/browser-dev.json`。

浏览器组包含六项认证页面、七项店铺页面和四项真实 Dashboard。认证／店铺页面使用 API 拦截覆盖 UI 边界，四项 Dashboard 连接本轮隔离的真实 Go／MySQL／Redis；旧多字节凭据的真实落库登录由 Go SQLite／MySQL／HTTP 用例覆盖。每个浏览器阶段仅重置本轮临时 Redis 中合成账号与本机 IP 的两个限流 key，生产策略继续保持每分钟 IP 20 次、邮箱 5 次。

生产模式检查使用本地 HTTP 监听及 HTTPS Origin 配置，覆盖配置校验、就绪与进程退出。真实 TLS／代理／Secure Cookie、真实旧库、Docker／race 继续归环境待验收。验收恢复 HMR 改动、清理本轮拥有的进程并保留用户 `.env`、既有数据库、参考仓库与原 POC。

## 历史验收快照（认证迁移初始批次）

命令：`rtk pnpm verify`。历史记录：`/home/dream/wwwroot/go-starter/.runtime/project-qt530ewl/result.json`；最近结果入口：`/home/dream/wwwroot/go-starter/.runtime/project-latest.json`。运行产物和日志保存在对应 `.runtime` 目录，文档保留统计与环境边界。

| 检查项                  | 结果                                          |
| ----------------------- | --------------------------------------------- |
| 流程检查                | 18 项通过                                     |
| Go 测试通过记录         | 226 条，包含父用例、子用例及各阶段执行记录    |
| 公共 auth 测试          | 12 项通过，包含真实 MySQL 初始化与 Redis 限流 |
| 执行的 Go 用例跳过      | 0；独立 Web 故障用例在专门阶段执行            |
| 内嵌 SPA 浏览器         | 4 项通过                                      |
| 宿主机 Vite 开发浏览器  | 4 项通过                                      |
| 公共 Dashboard 单测     | 2 项通过                                      |
| 公共 Dashboard 源码 HMR | 通过，窗口标记保留，整页刷新次数为 0          |
| 全流程耗时              | 117.67 秒                                     |
| Docker／race detector   | 环境待验收，单独登记                          |

以上计数为认证迁移初始批次的历史快照；本次审查修复的完整结果另节登记。

环境为 Linux amd64／WSL、项目锁定 Go 1.26.8、Atlas Community v1.3.0，以及真实 MySQL 8.0.46。验收创建临时 MySQL 数据目录、专用 Redis 进程、随机端口和受限数据库账户，故障测试仅操作脚本拥有的进程。认证 ORM 单测使用独立 `MYSQL_AUTH_TEST_DSN` 数据库，业务单测使用 `MYSQL_TEST_DSN`，隔离并发建表。

## 本批次交付

1. **公共模型与迁移**：user／session／account／verification、初始化单例锁表；应用组合模型，生成 Gen 查询与双方言 Schema；新增 `202610040001_email_auth.sql`，保留认证改造前的初始 SQL 与 checksum 条目。认证表保留 signed int、历史索引名称、nullable／默认值、MySQL 更新时间及外键级联契约。
2. **邮箱认证与会话**：固定版本 Better Auth 密码 fixture、NFKC／scrypt、Cookie 签名与原始／签名 Bearer、数据库会话查询／续期／过期／退出撤销、账号封禁检查。续期返回的时间字段与数据库持久化值保持一致。
3. **初始化与基础授权**：部署初始化密钥、首位 owner、跨连接／跨进程事务互斥、旧管理员存在时的关闭条件、API 身份 context 与配置化管理员路径校验。公共模块的 Dashboard 路径及权限回调由应用提供。
4. **安全边界**：精确 Origin、Cookie 写请求与 WS 握手的 CSRF 校验、显式 CORS、共享 Redis IP／邮箱限流、每进程四个密码派生并发槽、错误脱敏、生产密钥与 HTTPS Origin 配置检查。
5. **真实 SPA**：`/admin/login`、`/admin/install`、受保护后台及退出；保留桌面／移动端、店铺创建／唯一约束、深链、主题、字号和公共包 HMR 回归。
6. **兼容清单**：记录剩余功能归属、旧源码／SDL／协议证据、当前覆盖范围，以及新库、已有 Go 示例库、真实旧库三条迁移路径。

## 自动化证据

| 场景               | 证据与断言                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧密码与 Cookie    | `/home/dream/wwwroot/go-starter/packages/go-server-kit/modules/auth/fixtures/better-auth-1.6.24.json`；独立 Node 生成样本由 Go 验证，错误密码与损坏签名被拒绝 |
| 初始化             | SQLite 多连接与真实 MySQL 多连接；两个独立 Web 同时初始化仅一次 201、另一次 409；失败事务回滚；已有管理员阻止再次初始化                                       |
| 旧账号完整性       | 在真实 MySQL 插入固定 ID、旧散列和 provider 凭据，登录后原 ID 与散列保持；用户删除验证 session／account 外键级联                                              |
| 会话               | Cookie／Bearer 跨实例身份一致，续期与持久化一致，过期／封禁拒绝，退出后 Cookie 与 token 重放失效                                                              |
| 基础权限与输入安全 | 匿名 401、member 管理路径 403；错误 Origin／Cookie 写请求 403；CORS 预检、输入上限、限流与 Redis 故障脱敏                                                     |
| Schema             | MySQL／SQLite 真实 Atlas 迁移、重复执行、版本登记与 MySQL 目标结构 diff；认证默认值、索引、外键与 signed int 断言                                             |
| 原协议与 Worker    | REST／双 GraphQL、跨实例 WS 广播／查询 SSE、Redis 故障／恢复、Web 崩溃 TTL、活动连接退出及 Asynq 消费                                                         |
| 开发与产物         | 可重复生成、Go vet、前端类型检查、静态 Web／Worker、双 Air 重建、浏览器两种模式与公共包 HMR                                                                   |
| 参考与 POC         | 验收确认原 POC 与参考仓库保持原样                                                                                                                             |

主要实现与测试：

- `/home/dream/wwwroot/go-starter/packages/go-server-kit/modules/auth/`。
- `/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/schema/export_test.go`。
- `/home/dream/wwwroot/go-starter/projects/multi-database-demo/frontend/tests/dashboard.spec.ts`。
- `/home/dream/wwwroot/go-starter/scripts/verify-project.py`。

## 启动与升级

已有 Go 示例环境先使用迁移账户执行新增版本，随后将应用 `.env` 的 `DB_VERSION` 更新为 `202610040001`，填写至少 32 字节随机 `AUTH_SECRET` 与临时 `AUTH_BOOTSTRAP_TOKEN`，确认 `APP_MODE` 和精确 `ALLOW_ORIGINS`。应用运行账户具有认证表所需 CRUD 与版本登记表的只读权限。

首次进入 `/admin/install` 创建 owner，完成后清空 `AUTH_BOOTSTRAP_TOKEN` 并重启 Web。两个 Web 实例共享数据库、认证密钥和 Redis 限流命名空间。本轮验收使用隔离环境，现有用户 `.env` 与数据库保持原状。

真实旧库采用审核后的专用 baseline 与升级目录，先核对四表、索引、外键与时区。详细操作边界见 `/home/dream/wwwroot/go-starter/docs/migration-compatibility-matrix.md`。

## 环境待验收与后续阶段

- **真实旧库**：生产快照、完整历史业务数据、TZ／DSN loc／数据库会话时区、既有登录态样本、备份恢复及切换回滚。本批次真实集成库采用 UTC；沿用旧登录态需一致密钥、Cookie 名／域策略与时区。
- **生产交付**：Docker 镜像与同镜像双角色运行、具备 C 编译器的 race detector、真实 HTTPS／域名／代理、Secure Cookie／跨子域策略与可信代理 IP 配置。
- **R2**：完整角色／资源／动作权限、用户 CRUD、会话管理、最后 owner 保护和管理操作审计；本批次已接入基础管理员路径与封禁检查。
- **认证扩展**：rememberMe／callbackURL、邮件验证／找回密码、OAuth、模拟登录及完整 Better Auth 插件／SDK 动作按后续使用清单锁定。当前浏览器与 Bearer HTTP 调用已验证，真实 App／小程序客户端联调待对应环境。
- **长连接生命周期**：现有连接按既有流生命周期结束；会话周期复核、即时封禁和退出后主动断连进入后续专项。

剩余阶段顺序见 `/home/dream/wwwroot/go-starter/docs/remaining-migration-plan.md`；下一阶段进入 R2 权限、用户管理与审计。

## 历史专项：初始化后登录失败排查（2026-10-04）

本轮按运行中 Web 进程的实际数据库配置只读检查，`user` 与 `account` 表记录数均为 0，初始化锁行存在且 revision 为 0，运行账户具备 user／account／auth_bootstrap 的 CRUD 权限；开发代理与 Web 入口的 `/api/auth/install-status` 均返回 `installed: false`、`enabled: true`。当前环境仍处于管理员待初始化状态；单次初始化请求的具体失败原因需依据该请求响应确认。

密码逻辑保持 NFKC、scrypt N=16384／r=16／p=1／64 字节派生以及 `hex-salt:hex-key` 格式。专项验证结果：

- 新增 5 组隔离 SQLite HTTP 全链路用例：初始化、凭据落库、初始化状态、重建服务后同密码登录、错误密码拒绝；覆盖 ASCII 最小／最大长度、中文、全角字符、空格和特殊符号，全部通过。
- 对照本机原参考仓库固定的 `@better-auth/utils@0.4.2`：Node 验证 5 组 Go 散列、Go 验证 5 组 Node 散列，全部通过。测试使用合成密码，保留用户密码与数据库原状。
- 新增 5 项认证页面回归，覆盖待初始化自动跳转、初始化入口关闭提示、失败时保留表单、成功提示与状态刷新、UTF-8 密码字节边界和统一登录错误，全部通过。页面测试通过 Playwright 拦截认证接口；真实认证链路由前述 Go 测试覆盖。
- `rtk pnpm check` 与 `rtk pnpm test` 通过，包含前端构建、类型检查、Go vet、四空格格式、Go 与 Dashboard 单测。专项 Go 认证测试中的真实 MySQL 初始化与 Redis 限流用例因本轮未提供隔离测试环境而跳过；此前的全量通过记录属于历史验收快照。

访问 `/admin/login` 时读取初始化状态，`installed: false` 自动跳转至 `/admin/install`；初始化入口关闭时，安装页显示关闭提示。初始化成功后更新并重新读取状态，跳转登录页显示“管理员初始化成功”，保留规范化邮箱，清空密码与初始化密钥。前后端的新密码长度统一为 12–128 个 UTF-8 字节。登录上限在本次审查修复中独立调整为 512 字节，以覆盖旧多字节密码。

人工复验使用 `http://127.0.0.1:5173/admin/install`，填写应用配置中的 `AUTH_BOOTSTRAP_TOKEN`，提交后确认初始化接口返回 201、登录页显示成功提示、状态接口返回 `installed: true`，再使用刚设置的邮箱和密码登录。初始化成功后移除临时初始化密钥并重启 Web。
