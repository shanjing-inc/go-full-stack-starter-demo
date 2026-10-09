# 第一阶段正式工程验收

验证日期：2026-10-03。目录：`/home/dream/wwwroot/go-starter`，分支：`main`。

## 交付范围

第一阶段已建立两个团队公共包与一个真实业务示例应用：

- `packages/go-server-kit`：Go 基础设施与传输适配；独立 Go module。
- `packages/shadcnui-dashboard`：`@shanjing/shadcnui-dashboard`，提供后台壳层、导航、会话适配、主题与基础组件。
- `projects/multi-database-demo`：应用装配、Shop 模型与 Service、双 GraphQL、REST、实时通信、任务、最终迁移与后台页面。
- 根目录 `go.work`、pnpm workspace 与统一工具脚本：宿主机开发、生成、迁移、检查、测试和构建。

原五组 `poc/` 保留兼容性验证证据；参考 Astro 仓库保持只读。应用示例当前显式运行 `APP_MODE=development`，会话返回固定开发用户。认证、服务端授权、完整旧业务迁移与远程包发布继续进入专项。

## 实际执行与证据

完整命令：

```bash
cd /home/dream/wwwroot/go-starter
rtk pnpm verify
```

本次结果：**通过**。耗时 94.55 秒；16 项流程检查均通过。

| 执行项                               | 结果与统计口径                                               |
| ------------------------------------ | ------------------------------------------------------------ |
| 正式 Go 单测及真实 MySQL／Redis 集成 | 189 条通过记录，包含父用例与子用例；外部独立进程组分阶段执行 |
| 跨实例实时与故障组                   | 4 条通过记录：双 Web、SIGKILL、SIGTERM、Redis 停机           |
| Go 测试通过记录合计                  | 193 条；执行阶段的 Go 用例零跳过                             |
| Dashboard 单测                       | 2 项通过                                                     |
| 内嵌 SPA 浏览器                      | 3 项通过，零跳过、零重试                                     |
| 宿主机开发浏览器                     | 同组 3 项通过，零跳过、零重试                                |
| 公共 Dashboard HMR                   | 通过，窗口标记保留，`pageReload=false`                       |
| 工具、生成、静态检查与构建           | 通过；Web／Worker 均为静态链接二进制                         |

本次固定证据目录：`/home/dream/wwwroot/go-starter/.runtime/project-1esvuksw`。

- `result.json`：流程与 Go 测试记录、耗时、待验收项。
- `browser.json`／`browser-dev.json`：两种运行方式的 Playwright 记录。
- `公共Dashboard源码HMR.log`：公共源码热更新断言。
- `宿主机ViteAir开发.log`：应用源码／公共 Go 源码重建、两个角色恢复及统一清理。
- 各阶段 `.log`：工具、数据库、服务与故障测试原始输出。
- `.runtime/project-latest.json`：后续执行覆盖的最近结果。

证据目录属于本地忽略的运行产物；可通过同一命令在具备依赖的 Linux amd64／WSL 宿主机重建证据。测试口径为 `go test -json` 的带 `Test` 字段通过记录，父子用例分别计数。

## 四空格规范专项回归

2026-10-03 完成正式工程四空格格式统一，并将格式检查接入 `pnpm check`，将 Go 生成后的格式化接入 `pnpm generate`。编辑器规则、Prettier 与 Ruff 配置纳入仓库，格式工具版本锁定。

专项执行 `pnpm format:check`、格式范围与只读检查单测，以及完整 `pnpm verify`：17 项流程检查通过，197 条 Go 测试通过记录；新增 Go 格式工具单测 4 项、Python 格式入口单测 2 项。Dashboard 单测 2 项、内嵌 SPA 浏览器 3 项、宿主机开发浏览器 3 项全部通过；两次代码生成结果保持一致，公共源码热更新与双角色退出通过。

专项证据目录：`/home/dream/wwwroot/go-starter/.runtime/project-zqq0nsn4`，完整验收耗时 114.6 秒。字符串字面值保持原值；原 POC、参考仓库及数据库 migration／checksum 保持原样。Docker 与 race detector 沿用下方待验收边界。

## Go 编辑器诊断专项

2026-10-03 排查 `redis_test.go` 的 `undefined: redis` 诊断：编辑器使用 Go 1.26.2 与默认 GOPATH 缓存，正式工程脚本使用固定 Go 1.26.8 与项目 `.tools` 缓存。默认缓存的离线依赖加载检查显示缺少工作区依赖；切换到工程环境后，该文件编译与语言服务器检查通过。

新增 `.vscode/settings.json`，为 VS Code／Trae Go 扩展绑定固定 Go、项目 GOPATH／module cache／build cache 与依赖代理。沿用编辑器的语言服务器选择，Go 格式工具补上标准输入／输出支持，并由扩展的自定义格式化入口调用；工作区设置同步纳入格式检查。

使用当前编辑器的 `trae-gopls v0.22.0+bd4` 在工程环境下检查 73 个应用／公共包 Go 文件与 2 个 tools Go 文件，检查通过；标准输入／输出四空格格式化检查通过。对应日志位于 `.runtime/editor-gopls-workspace.log`、`.runtime/editor-gopls-tools.log` 与 `.runtime/editor-gopls-tools-auto.log`。该结果为语言服务器命令行验证；编辑器窗口应用新配置后需重新加载诊断。

完整 `pnpm verify` 再次通过：17 项流程检查、199 条 Go 测试通过记录，含 6 项 Go 格式工具单测；Python 格式入口单测 2 项、Dashboard 单测 2 项及两组各 3 项浏览器测试通过。耗时 104.72 秒，证据目录：`/home/dream/wwwroot/go-starter/.runtime/project-e3ic5q12`。Docker 与 race detector 沿用待验收边界。

## 已通过的工程检查

### 工作区、依赖与代码生成

1. 固定 Go／Atlas 下载校验、三个 Go module 的独立依赖校验、Air 与 pnpm 安装。
2. 连续两次生成双 GraphQL、Gen 与 MySQL／SQLite 目标 SQL，比较结果哈希一致。
3. Go vet、公共包与 demo 前端类型检查、Dashboard 单测及前后端构建。
4. 静态 Web／Worker 构建，Web 二进制内嵌后台 SPA，API 路径与 SPA fallback 隔离。

### 数据库与应用运行

1. 隔离 MySQL 实例实际版本为 `8.0.46-0ubuntu0.24.04.4`；Atlas 社区版执行正式 MySQL／SQLite 初始迁移并登记版本 `202610030001`。
2. 重复执行 MySQL 迁移通过；正式迁移结果与生成的 MySQL 目标 Schema 一致。
3. 应用账户仅具业务表读写与 Atlas 登记表查询权限，双 Web 与独立 Worker 启动通过；迁移执行使用隔离实例的独立 root 账户。
4. 双 GraphQL 与 REST 真实读取同一数据库；GraphQL 创建、slug 唯一错误、SSE／WS 跨实例通信及 Worker 任务消费通过。
5. 迁移登记异常触发 readiness 故障；版本错误、登记缺失和生产模式分别触发 Web／Worker 启动失败。缺登记数据库保持空库，验证入口只读检查边界。
6. SQLite 执行正式迁移后通过真实 Web 启动门禁。

### Redis、实时与任务

- Cache：JSON、TTL、namespace 隔离与损坏值处理。
- Lease：互斥、token 所有权、原子续租／释放、过期接管。
- Bus：既有 v1 信封、有限订阅、就绪确认、跨实例查询与广播、取消／超时与故障清理。
- Queue：真实消费、namespace、重复任务 ID 保留、SkipRetry 归档、进入重试状态与取消。
- Schedule：共享启停、Leader 接管、派发状态与手动任务幂等。
- 应用任务：Redis 原子副作用幂等与并发测试；真实 Web 投递、Worker 消费、完成任务 ID 保留。
- 每种独立故障场景使用新 Redis 与新双 Web：强制退出 TTL、优雅退出及 Redis 停机。故障 PID 来自脚本拥有的 `Popen` 对象。

### Dashboard 与宿主机开发

1. 后台实际调用 Go API，完成概览、创建、唯一约束错误与深链刷新。
2. 深浅主题、字号持久化、退出适配器与移动侧栏通过；布局宽度与页面异常检查通过。
3. Vite、Air Web、Air Worker 统一启动；共享应用 Go 源码与公共 Go 包源码分别触发两个入口重建，修改后恢复源码。
4. React 组件与上下文 Hook 分文件维护；公共 Dashboard 源码热更新通过浏览器窗口标记检查，更新后恢复源码。
5. pnpm 包装器收到 SIGTERM 后返回信号退出码；监管器完成后代进程收养与进程组清理，Web／Vite 监听关闭。Web 与 Worker 优雅退出独立验收通过。
6. 原 POC 文件哈希与参考仓库 Git 状态在验收前后保持一致；常驻宿主机 MySQL／Redis保持运行。

## Shop Schema 自检

结论：**已验证，有兼容例外**。依据团队 MySQL Schema 规范与设计 checklist；实际模型、生成 SQL、正式迁移和 MySQL 集成证据相互对应。

| 检查项           | 状态与依据                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------- |
| 命名与基本结构   | 单数 `shop`，字段小写蛇形，主键及创建／更新时间齐全                                           |
| 引擎与字符集     | InnoDB、utf8mb4、utf8mb4_unicode_ci                                                           |
| 字段语义         | 全部 MySQL 字段含 COMMENT；状态注释列明 active／inactive                                      |
| 查询与索引       | ID 查询走主键；slug 查找与业务唯一走 `uk_slug`；状态等值过滤走 `idx_status`                   |
| 写入约束         | 创建与更新使用 Gen 参数绑定；slug 唯一约束在数据库验证                                        |
| 分页与查询范围   | 查询使用显式字段，当前 `eq` 条件与受限分页；完整旧业务过滤和高数据量分页后续专项              |
| 关联、软删、金额 | 样例仅含单表，直接删除；关系、软删与金额／结算在实际业务接入时定义                            |
| 数据库对象       | 样例结构限定表与索引，关联一致性由应用维护                                                    |
| 主键兼容例外     | signed bigint 自增，Go int 延续现有 Service 接口；SQLite 使用 integer 自增                    |
| 状态兼容例外     | varchar(32) 与字符串 API 契约对应；enum 语义由 Service 校验                                   |
| 迁移归属         | 应用维护最终 MySQL／SQLite migrations、checksum 与版本配置；模型测试的 AutoMigrate 限于隔离库 |

真实旧数据库导入继续以实际快照和业务查询为准。该单表样例覆盖当前工程整合链路。

## 待验收与后续边界

| 项目                 | 当前状态与下一步                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker               | 已提供多阶段、非 root scratch、CA／时区、同镜像两个角色的 Dockerfile；当前命令环境缺少 docker。补镜像构建、基础镜像摘要、容器启动／退出与生产配置验收 |
| race detector        | 当前工具链 CGO_ENABLED=0，命令环境缺少 cc／gcc；在具备 C 编译器的环境执行 race 与并发压力测试                                                         |
| 认证与授权           | 当前固定开发身份，生产模式门禁生效；接入邮箱／手机号登录、Better Auth 参考表结构与服务端授权                                                          |
| 真实旧业务与数据     | 完整过滤、业务模型、旧表快照／baseline 和旧客户端端到端继续专项迁移                                                                                   |
| 生产实时与任务可靠性 | 反向代理／TLS、跨域身份、Redis 高可用、持久化业务幂等、历史与备份策略进入部署／业务专项                                                               |
| 包发布与模板         | 当前 workspace／本地 replace 联调；远程 Go 依赖、npm 发布、版本组合和模板导出需单独验收                                                               |

本阶段源码保持未提交。提交、推送与发布按各自授权推进。
