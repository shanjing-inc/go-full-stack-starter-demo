# 剩余功能迁移规划

规划日期：2026-10-04。工作目录：`/home/dream/wwwroot/go-starter`，实施分支：`develop`（用户已合并上一批，后续直接在此开发）。

状态：R0／R1 与店铺列表已完成本地验收；上一批完整报告包含 18 项流程检查、289 条 Go 测试通过记录、双浏览器各 17 项。R2 第一批接入权限矩阵、用户只读查询、公共用户列表与查询审计；最终 18 项流程检查、365 条 Go 通过记录、公共 UI 10 项、双浏览器各 26 项通过，本批验证见 `/home/dream/wwwroot/go-starter/docs/user-query-verification.md`。兼容矩阵见 `/home/dream/wwwroot/go-starter/docs/migration-compatibility-matrix.md`，R0／R1 验证结果见 `/home/dream/wwwroot/go-starter/docs/auth-migration-verification.md`。R2 第二批已接入用户创建、编辑、角色、封禁／解封、全部会话撤销和管理审计，验收见 `/home/dream/wwwroot/go-starter/docs/user-management-verification.md`。后续 R2–R6、提交与发布按各自授权推进。

本阶段认证范围：邮箱密码登录、退出、Cookie／Bearer 会话与首位 owner 初始化。手机号登录、短信验证码、手机号绑定及相关新增字段进入后续专项。

## 1. 当前基线

已完成正式工程整合：`go-server-kit` 基础设施与传输适配、`@shanjing/shadcnui-dashboard` 后台壳层、Go MySQL demo、双 GraphQL、Shop 基础读写、Redis Bus 查询与广播、Asynq／代码调度，以及统一开发、生成、迁移和构建命令。

规划阶段基线产物：17 项流程检查、208 条 Go 测试通过记录，耗时 132.12 秒。该记录保留为认证改造前的历史对照；当前结果以本批验收记录为准。统计包含父用例与子用例；Docker 与 race detector 保留环境待验收状态。

证据：`/home/dream/wwwroot/go-starter/.runtime/project-8nmdkxf1/result.json`；最近结果入口：`/home/dream/wwwroot/go-starter/.runtime/project-latest.json`。这些文件属于本地运行产物。

现有边界：

- 真实邮箱登录、初始化与退出已接入；应用支持显式 development／production，生产 TLS 与部署拓扑待验收。
- 公共 auth 四表、Service、角色／资源／动作权限、用户查询和第二批管理写操作已接入；密码修改与重置延后至 R6 最终收尾，所有权转移及队列管理后续能力按阶段推进；会话列表与单会话撤销已通过本轮全量验收。
- 当前 Shop 支持查询、创建、列表分页及 slug／status 筛选；完整业务 CRUD、关系与剩余过滤继续迁移。
- Dashboard 已有布局、导航、主题、字号、店铺列表、公共用户管理和首批队列页；剩余用户操作、队列健康／调度操作、Member 后台及完整业务页面继续接入。
- 公开首页与队列测试页已接入 Go SSR，后台继续由 React SPA 承载；首批边界和证据见 `/home/dream/wwwroot/go-starter/docs/public-ssr-verification.md`。
- 公共包使用 workspace／本地 replace；远程固定版本依赖、模板导出与生产运行进入交付阶段。

参考基线采用 Astro 公共包与 Deno MySQL demo。Go 版沿用已确认的 Echo v5、gqlgen、GORM + Gen、Atlas、Redis、Asynq 和 React SPA 工程结构。

## 2. 功能差异清单

| 能力           | 当前 Go 状态                                                             | 剩余迁移内容                                                                       | 阶段      |
| -------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------- |
| 公共标准模型   | 认证四表与初始化锁表已组合进应用迁移                                     | 账号后续扩展字段与审计模型                                                         | R2        |
| 邮箱密码认证   | 登录、退出、Cookie／Bearer、旧散列兼容已接入                             | 邮件验证／找回密码及插件动作按后续专项锁定；手机号能力延期                         | R1 已验收 |
| 初始化与权限   | 首位 owner 事务初始化、API 身份及资源动作权限已接入                      | 权限矩阵与查询／管理审计已接入；审计存储与保留周期按部署配置                       | R2        |
| 用户／会话管理 | 公共查询、管理写操作、禁用／启用及会话管理已接入                         | 所有权转移；密码修改／重置归 R6 最终收尾，用户删除列为范围外                       | R2、R6    |
| 完整业务模型   | Shop 样例                                                                | 对齐 Shop，接入 Product、Order、关系与现有数据                                     | R0、R3    |
| 完整业务 API   | getShop、createShop、listShops 分页／筛选／排序子集                      | Admin／Member 全量查询、Admin CRUD、过滤、排序、分页、关联加载及金额／时间语义     | R3        |
| 队列／调度后台 | Worker 在线／RSS、队列概览、执行记录／详情、单次手动重试及计划监控已接入 | 健康详情、调度共享开关操作、后台手动清理及治理任务                                 | R4        |
| Dashboard 页面 | 登录／初始化／退出、概览、店铺、公共用户与首批队列页已接入               | 剩余用户操作、队列健康／调度操作、Admin／Member 业务页及剩余组件                   | R2 至 R5  |
| 通用 WS／SSE   | Bus 专用路径已完成                                                       | public／member／admin WS、标准消息及推送示例、public SSE、客户端生命周期与认证接入 | R5        |
| 查询与缓存补齐 | Redis Cache、Bus、Lease 已完成                                           | 请求级关联加载缓存／批查询、既有缓存示例与真实调用；持续复用现有基础设施           | R3、R5    |
| 日志与错误观测 | slog、request ID、错误公开规则已完成                                     | 参考 Sentry 行为的 Go 接入方案、脱敏、队列／协议关联追踪与运行观测                 | R5、R6    |
| 团队交付       | 本地工程可运行                                                           | 公共包版本组合、私有依赖获取、模板导出、Docker／TLS／反向代理及生产验收            | R6        |

每项在 R0 建立证据关联，状态使用“已验证／部分覆盖／待实现／环境待验收／范围外”。后续关闭清单项时，同时记录实现路径与测试证据。

### 2.1 Docker 验收进度（2026-10-05）

正式项目已新增 `pnpm verify:docker`，旧 Delivery POC 验收入口继续保留历史范围。当前源码的正式多阶段构建和 MySQL／Redis 依赖容器拓扑 14 项流程已通过，离线容器运行 13 项流程已通过，覆盖同镜像双 Web／独立 Worker、非 root 与只读根文件系统、受限数据库账户、认证／业务／WS／SSE、启动门禁、健康恢复及 SIGTERM。脚本回归已接入 `pnpm test`。

R6 的正式 Docker 构建与本地容器运行验收已通过，宿主 7897 代理打通镜像、Dockerfile 前端和 npm／Go 依赖下载；生产 TLS／反向代理／Secure Cookie、真实旧库切换、容量及远程包发布继续保留独立关口。两种 Docker scope 的报告与证据见 `/home/dream/wwwroot/go-starter/docs/docker-deployment-verification.md`。

## 3. 需要先处理的兼容差异

### 3.1 Shop 样例与参考表

| 项目     | 当前 Go 样例                  | 参考 Deno MySQL demo                  |
| -------- | ----------------------------- | ------------------------------------- |
| 主键     | signed bigint，Go int         | MySQL int 自增                        |
| 状态     | active／inactive，默认 active | draft／active／archived，默认 draft   |
| 唯一索引 | uk_slug                       | shop_slug_unique                      |
| 状态索引 | idx_status                    | shop_status_idx                       |
| 时间     | GORM datetime 与写入行为      | zonedDateTime、自带创建／更新默认行为 |

R0 对照参考生成 SQL 与可用的实际库快照确认类型、索引、默认值和时区；R3 完成模型／Service 对齐。变更通过新的应用迁移表达，已验证的迁移及 checksum 保留可追溯历史。真实旧库与当前 Go 样例库分别制定升级路径。

### 3.2 认证与数据契约

- 参考公共包已有 user／session／account／verification；参考 demo 当前启用邮箱密码、Admin 和 Bearer 能力。本阶段沿用邮箱密码入口。
- 旧密码兼容以参考仓库锁定版本的实际散列实现和生成样本验证；保留旧账号、provider 标识与凭据字段。
- 会话数据兼容、Cookie 签名兼容、旧客户端继续登录分别建立验收项。沿用旧会话或统一重新登录的策略进入 R1 决策记录。
- 参考 user.email 为必填且唯一；本阶段保留该约束。手机号账号及相关 schema 扩展进入后续专项。
- 参考权限包含 owner／admin／member／user。服务端覆盖具体资源与动作，前端消费相同权限结果。

### 3.3 协议及平台替换

- 既有 GraphQL 字段、参数、可空性、错误公开规则与日期格式逐项对照 SDL 和 golden fixture。
- BullMQ 的执行记录、状态、重试和统计语义通过 Asynq／公共记录层映射；保留对外契约，并明确字段来源及信息缺口。
- 参考项目的 PM2／Node 内存信息按 Go Web／Worker 进程、实例心跳和运行指标重建；记录指标语义变更。
- 参考 Admin 路径由项目配置；现有 Go 默认路径为 `/admin/`。建立可配置后台前缀与路由清单，默认演示路径继续沿用 Go 工程设置。

## 4. 实施顺序与阶段验收

### R0：兼容清单与数据库基线

**目标：** 冻结剩余迁移范围，确定旧表与协议契约，形成后续模块可执行的输入。

交付：

1. 建立按功能登记的迁移矩阵：公共包／demo 归属、旧实现、新实现、接口、数据表、权限、golden 与验证状态。
2. 提取完整 Admin／Member SDL、Auth 路由、WS／SSE 协议和后台路由；记录参考版本与 fixture 来源。
3. 对照公共四表、Shop／Product／Order 及实际可用数据库的结构、索引、关联、默认值和时间语义；登记当前 Go 样例差异。
4. 制定旧库 baseline、当前 Go 示例库增量升级与全新数据库初始化三条路径；缺少实际快照的项目明确标记为生产待验证。

验收：参考源码只读；迁移矩阵覆盖本规划全部行；既有数据库结构与数据的升级预期明确；差异清单能关联到具体文件及 fixture。

**依赖：** 当前正式工程。**下一阶段输入：** 公共模型定义、完整 SDL、已锁定认证契约及数据库兼容约束。

### R1：公共认证模型与真实登录

**目标：** 实现真实用户身份闭环，让后续后台功能建立在可校验的会话上。

交付：

1. 在公共模块维护 user／session／account／verification 标准模型，应用组合模型、生成 Gen 与最终 MySQL／SQLite 迁移。
2. 明确 Go 认证实现及凭据、Cookie／Bearer 契约，接入邮箱密码登录、退出、查询／刷新／撤销会话和账号封禁检查。
3. 完成首位 owner 初始化、初始化关闭条件及并发保护；管理初始化默认受显式开关／部署凭据控制。
4. 替换固定开发会话，接入真实 SPA 登录、初始化和退出；Web／GraphQL／WS／SSE 统一从验证后的请求身份装配 context。

验收：

- 参考版本生成的密码样本可由 Go 验证，错误密码、异常散列与账号封禁有受控结果；会话升级策略有独立用例。
- 邮箱登录、退出、过期／撤销和双实例身份校验通过；登录限流与会话并发处理有明确断言。
- 浏览器 Cookie 与 App／小程序 Bearer 调用分别验证；Cookie 安全属性、Origin／CSRF、CORS、日志脱敏进入测试清单。
- 初始化并发只生成一个初始 owner；旧账号及数据保持完整；依赖与密钥配置检查通过。

**依赖：** R0。**边界：** 本阶段交付邮箱密码登录与会话管理；真实生产域名策略单独记录环境验收。

### R2：服务端权限、用户管理与审计

**范围决定（2026-10-06）：** 用户账号仅支持禁用／启用，账号及关联业务数据持续保留；后台与 API 禁止删除用户，`deleteUser` 列为范围外。禁用复用现有 `banned`／`user:ban` 契约，禁用与撤销该用户全部会话在同一事务完成；启用后通过正常登录建立新会话。现有自禁用限制及最后可用 owner 保护继续生效。

**优先级决定（2026-10-06）：** 密码修改属于低频功能，用户自行改密、管理员重置及相关管理入口统一延后至 R6 最终收尾，后续业务、队列及实时能力按现有认证／权限基线推进。创建用户时设置初始密码、现有登录校验、散列兼容与会话管理继续保留；首次登录强制改密、管理员密码复核、统一重新登录及密码强度调整作为收尾阶段待确认规则。

**第一批交付（2026-10-04）：** 可配置权限矩阵、REST／GraphQL／连接入口共用校验、用户三项只读查询、公共 Dashboard 用户列表、查询及权限拒绝结构化审计。手机号范围继续延期。

**第二批交付（2026-10-05）：** 邮箱用户创建及初始密码、名称编辑、角色调整、封禁／解封、撤销用户全部会话、字段权限与角色授权范围、owner 管理门禁及最后可用 owner 保护、管理操作审计。公共 Dashboard 与 Admin GraphQL 同步接入；角色变更和封禁在同一事务撤销会话，登录在会话写入前复核最新账号状态。验收见 `/home/dream/wwwroot/go-starter/docs/user-management-verification.md`。

**第三批交付：** 有效期内的用户会话列表、单会话撤销、当前会话标识及公共 Dashboard 弹窗。复用 `session:list`／`session:revoke`、owner 与目标权限范围保护，查询投影及审计保持令牌脱敏。验收见 `/home/dream/wwwroot/go-starter/docs/session-management-verification.md`。

**后续批次：** 所有权转移。密码修改／重置统一延后至 R6 最终收尾。审计存储接入与保留周期由部署配置。手机号登录保持延期。

**目标：** 将通用后台系统功能落入公共模块，业务应用复用一致的权限契约。

交付：

1. 实现可配置角色／资源／动作权限，沿用 owner／admin／member／user 及参考权限名；REST、GraphQL 和连接入口使用公共校验入口。
2. 迁移 getCurrentUser、getUser、listUsers、createUser、updateUser，以及参考客户端实际使用的角色、禁用／启用与会话操作。创建用户时设置初始密码继续保留；密码修改／重置归 R6 最终收尾，用户删除列为范围外。
3. 首位 owner 与最后可用 owner 保护、越权字段控制、禁用后的会话处置形成事务与规则测试。
4. 将用户列表、编辑／创建弹窗、权限控制与会话操作抽取为公共 Dashboard 功能；适配器承接数据接口。
5. 记录身份／权限／用户及后续队列管理操作的操作者、动作、目标、结果、时间和 request ID；敏感字段脱敏，定义存储与保留策略。

验收：权限角色矩阵通过；未登录／越权场景有服务端断言；前端页面、直接 API、批处理及跨实例会话均覆盖；审计记录与业务结果关联一致。

**依赖：** R1。**决策边界：** 现有角色与权限配置作为首版输入；高级动态权限编辑按单独需求评估。

### R3：完整业务模型、CRUD 与 Admin／Member 业务页

**目标：** 完成示例业务与旧数据契约，将 Shop 子集扩展为真实可复用的业务接入示例。

交付：

1. 对齐 Shop，新增 Product／Order；保留外键／关联语义、唯一约束、状态、金额分字段及时间行为，业务模型集中在应用中。
2. 迁移 Admin 查询／CRUD 与 Member 查询；参考 Admin 基线含 14 个 Query 字段、13 个 Mutation 字段，Member 含 7 个 Query 字段；公共用户／队列字段由 R2／R4 共同完成。
3. 接入完整过滤操作、排序白名单、limit／offset 边界、关联加载和请求级批查询缓存；SQL／Service 承担筛选与分页，前端维护 URL 和当前页展示。
4. 迁移 Admin／Member 的概览、Shop／Product／Order 列表与既有交互；公共数据表、分页、筛选、状态／金额／时间组件按复用边界抽取。
5. 保留业务校验与错误契约，完成状态转换、数量／金额边界、事务及关联写入回归。

验收：SDL 与 golden 对照通过；旧数据夹具读写一致；真实 MySQL 验证索引／外键／唯一约束／事务／时区；分页排序稳定；关联查询有数量界限测试；Admin／Member 页面 E2E 通过。

**依赖：** R0、R1、R2。**迁移策略：** 新库初始化、Go 样例库升级与旧库 baseline 分别验收；实际旧库快照决定生产兼容结论。

### R4：队列／调度管理公共模块

**首批落地：** 后台导航按 Node.js 恢复“队列管理”分组，控制台与 recent／active／completed／failed／waiting 列表、记录详情各自使用 `/admin/queues` 系列路由；旧 `/admin/queue` 深链保留兼容跳转；计划任务 `/admin/queues/schedules` 已接入代码定义、共享启用状态、下次执行、最近派发、Leader 与调度器心跳只读展示。公共 `modules/queue`、共享 `QueuePage` 和应用组装已接入概览、执行记录列表／详情、单次手动重试。Redis 独立记录、递增执行序号、原任务复用、最新失败状态复核、真实账号权限复核、脱敏、失败安排审计、恢复和按链保留／清理均有实现与目标测试。完整验证范围见 `/home/dream/wwwroot/go-starter/docs/queue-management-verification.md`。

**后续批次：** 健康详情、调度启停／人工触发操作和后台手动清理入口；多 Worker 专项与生产 Leader 故障验收随对应能力完成。首批复用现有调度执行设施，容量优化保持 R6 待办。

**存储决定（2026-10-06）：** 首批沿用参考 Node.js 的 Redis 执行记录存储方案，手动重试操作审计一并保存在 Redis；容量评估及存储优化安排在 R6 最终收尾。

- Asynq 管理原任务的状态、保留及归档清理；手动重试复用仍存在的原任务，每次创建独立执行记录，历史记录及操作审计持续保留。
- 执行记录与重试审计使用独立键命名空间，保持与 Asynq 原任务生命周期的边界。执行记录默认保留 7 天，时长可配置；未结束重试链的关联记录持续保留。
- 原任务已被清理时，历史执行记录继续可查，重试入口禁用并提示原因。
- 首批保持 Redis 存储；MySQL 历史记录存储列为收尾阶段的评估候选，具体调整依据容量实测另行确认。

**目标：** 保留现有 Worker 基础设施，并接入可运维、可授权的公共后台能力。

交付：

1. 迁移 getQueueDashboard、getQueueHealth、getQueueSchedules、getQueueExecutionRecord、listQueueExecutionRecords、updateQueueExecutionRecord。
2. 建立执行记录与 Asynq 任务的 ID、状态、执行次数、耗时、错误、原始／重试关联和分页映射；明确持久化与保留窗口。
3. 接入 Worker／Scheduler 实例心跳、健康统计、代码定义调度共享启停、Leader 状态、权限及审计。
4. 迁移失败任务审计、执行记录清理和队列指标快照等已有治理任务；后台动作按 R0 使用清单实施，现有重试契约优先。
5. 在公共 Dashboard 迁移队列概览、任务记录、详情／重试、健康与调度页面；页内加载／错误／权限反馈沿用既有交互。

验收：真实 Redis 验证正常／失败／自动重试／手动重试／完成归档；多 Worker 及 Leader 交接通过；手动重试审计、状态冲突和幂等副作用覆盖；队列后台端到端测试通过。

**依赖：** R1、R2，以及现有 queue／schedule。**适配约束：** 旧 BullMQ 待执行任务接续处于既定首版范围外；Asynq 映射缺口逐字段登记。

### R5：通用实时协议、客户端与观测补齐

**目标：** 在已经通过验收的 Bus 基础上补齐通用端点与客户端使用闭环。

交付：

1. 迁移 `/api/websocket/public`、`/api/websocket/member`、`/api/websocket/admin` 和 `/api/sse/public` 的标准消息／应用推送与事件契约。
2. 为受保护连接接入身份、Origin 和资源权限；会话过期／撤销后的已有连接处置与连接／消息配额形成明确策略。
3. 抽取 Go API／GraphQL 请求、WS 与 SSE 客户端适配；完成取消、卸载、断线、错误和缓冲边界，覆盖服务端与浏览器两端生命周期。
4. 接入参考 Cache／Lock／Queue／Bus／实时示例的功能入口；在线设备查询沿用当前 ready、responseKey 隔离与幂等清理约定。
5. 完成错误采集方案、request ID／task ID／query ID 关联、日志脱敏及应用可选的 Sentry 适配；保留 public error 与内部诊断分层。

验收：通用端点 golden、认证／越权、浏览器取消与重连、慢消费、双实例及故障测试通过；原 Bus 查询／广播回归通过；观测输出的凭据和敏感载荷脱敏验证通过。

**依赖：** R1；后台客户端和示例整合依赖 R3／R4。**在线查询边界：** 当前在线实时请求与生命周期清理契约继续沿用；离线执行、持久化查询结果和历史重放列入范围外清单。

### R6：公共包发布、模板导出与生产交付

**最终收尾项（2026-10-06）：** 完善用户自行修改密码、管理员重置及后台入口。先对齐参考认证接口并锁定权限、会话撤销与审计契约；强制改密等增强规则届时确认。该项在 R6 最终收尾实施，R3–R5 沿用现有认证基线。

**队列存储优化待办（2026-10-06）：** R4 首批沿用 Redis，最终收尾时基于真实执行量及记录大小评估容量和优化方案。

- 按每次实际执行统计记录量，覆盖自动／手动重试、参数快照、结果、错误堆栈、索引、审计及未结束重试链；分别测量 Redis 内存和持久化磁盘占用，形成默认 7 天与自定义保留窗口的容量预算。
- 评估快照重复存储、索引及清理策略优化，并结合实际规模评估将执行记录与重试审计迁至 MySQL 的收益、迁移及兼容成本；方案届时确认。
- 核对 Redis 持久化、备份、淘汰策略、容量及写入失败告警；保留完整的部署配置和故障恢复验收边界。

**目标：** 形成仓库外可依赖、可启动、可运维的团队交付产物。

交付：

1. 后端 Go module 与前端 npm 包独立版本化；验证 Codeup 私有取包、已确认 npm registry、公开 API、固定版本组合和版本变更记录。
2. 以 Go MySQL demo 为唯一源码来源实现导出脚本，输入目录、项目名和 Go module；导出完整公共系统功能与最小业务示例，处理源码裁剪、导入路径、独立脚本和固定依赖。
3. 在仓库外的隔离目录、独立依赖缓存中完成取包、生成、迁移、检查、构建、Web／Worker 启动和关键流程；建立敏感文件排除检查。
4. 在认证／授权验收后完善生产配置与启动门禁；验证同镜像双角色、非 root、反向代理／TLS、Cookie 与跨域策略、WS／SSE 长连接、日志和健康检查。
5. 补齐具备 C 编译器的 race 验收、容器运行证据、CI 分层检查和部署／迁移／回滚说明；数据库升级的回退与数据备份策略独立审核。

验收：固定版本组合在仓库外实际安装与运行；导出目录中的凭据／缓存／依赖／构建产物排除检查通过；生产登录、权限、数据库门禁、长连接、Worker 和优雅退出通过；环境待验收项有独立结论。

**依赖：** R1 至 R5。发布／tag／commit／push 各自取得明确授权。

## 5. 依赖与可拆分工作

主线：`R0 → R1 → R2 → R3 → R4 → R5 → R6`。

- R3 的业务模型／CRUD 与 R4 的队列适配在 R2 完成后具备独立实施条件；各自保持独立测试入口。
- R5 的通用 WS／SSE 后端可在 R1 完成后展开；完整页面与客户端整合依赖相应业务／系统 API。
- R6 的发布及模板方案设计可以提前整理；发布版本组合与生产结论以功能验收完成为前提。

首个实施批次建议只覆盖 R0 和 R1：兼容矩阵、公共模型与真实认证闭环。该批次验收后再推进用户／权限公共模块。

## 6. 公共包与应用的职责约束

| 位置                      | 职责                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `go-server-kit/infra`     | 复用现有数据库、Redis、Bus、Cache、Lease、Queue、Schedule、配置与日志                  |
| `go-server-kit/transport` | 身份 context、公共错误与 GraphQL／HTTP／WS／SSE 接入基础                               |
| `go-server-kit/modules`   | 认证／账号、权限、用户管理、队列／调度管理、审计等通用系统功能；具体包名随 R0 契约确定 |
| `shadcnui-dashboard`      | 通用系统页、表格／筛选／分页组件和会话／权限／数据适配契约                             |
| Go MySQL demo             | 依赖装配、业务模型／Service／协议、Admin／Member 业务页、最终迁移和环境配置            |

公共标准模型与业务模型由应用组合；最终迁移归应用维护。REST／GraphQL 调用同一功能 Service。业务特有表、字段和规则集中在应用模块。

## 7. R1 认证决策与后续边界

| 决策         | 推荐方向                                                            | 验证／确认方式                                       |
| ------------ | ------------------------------------------------------------------- | ---------------------------------------------------- |
| 邮箱登录入口 | 保留邮箱密码，密码找回按参考行为和需求清单确定                      | 邮箱密码接口、旧凭据兼容与客户端流程验证             |
| Go 认证实现  | 公共 Go auth 模块复用既有四表、凭据与核心客户端契约                 | 固定版本散列 fixture、会话与 Cookie／Bearer 集成测试 |
| 旧会话接续   | 保留旧登录态需一致密钥、Cookie 策略及时区；切换流程记录重新登录影响 | 签名格式、token、过期时间与存储样本验证              |
| 初始化入口   | 显式部署开关／凭据保护、事务级并发控制、初始化后关闭                | 初始化及重复／并发调用测试                           |
| 权限与审计   | 沿用参考角色／动作名，公共模块提供扩展接口与结构化事件              | R0 动作矩阵、存储与保留策略记录                      |

R1 采用公共 Go auth 模块、既有四表、固定版本散列和数据库会话；生产旧会话保留条件见兼容矩阵。手机号认证与关联 schema 扩展留待后续专项。

## 8. 阶段质量门禁与范围

每阶段保留当前验证链路，并增量添加测试：

1. 格式、可重复生成、Go vet、前端类型检查与静态构建。
2. SQLite 快速测试和真实 MySQL schema／约束／事务／迁移测试。
3. 真实 Redis 与独立 Web／Worker 多实例、故障及退出测试。
4. REST／双 GraphQL／WS／SSE 的 golden、未登录／越权与业务验证。
5. 内嵌 SPA 与宿主机开发两组浏览器回归，按阶段补充公共模块页面及 Member 场景。
6. 版本化记录命令、环境、通过／跳过统计、证据路径和环境边界；阶段完成由功能与验收同时确认。

首版聚焦 Go＋MySQL＋Redis、Web／Worker 和后台 SPA。范围外事项继续单独登记：手机号登录及短信发送／账号绑定／相关字段扩展、BullMQ 待执行任务接续、Redis Cluster、动态新增／编辑 cron、Node／Go 上线双跑与流量切换、数据库版本升级及其他运行平台。公开 SEO／SSR 页面按原架构约定另行规划。

R0／R1 已在历史 `feature/email-auth-migration` 批次实施；后续开发按用户决定直接使用 `develop`。保留原 POC、参考仓库及认证改造前的迁移文件，验收产物按批次记录。提交与推送按用户单次授权执行。

## 9. 仓库依据

- 已确认架构与范围：`/home/dream/wwwroot/go-starter/docs/architecture-plan.md`。
- 正式工程验收：`/home/dream/wwwroot/go-starter/docs/phase-one-verification.md`。
- 当前应用说明：`/home/dream/wwwroot/go-starter/projects/multi-database-demo/README.md`。
- 当前模型与读写：`/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/model/shop.go`、`/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/service/database.go`。
- 当前 GraphQL：`/home/dream/wwwroot/go-starter/projects/multi-database-demo/schema/common.graphqls`、`/home/dream/wwwroot/go-starter/projects/multi-database-demo/schema/admin.graphqls`、`/home/dream/wwwroot/go-starter/projects/multi-database-demo/schema/member.graphqls`。
- 当前前端接入：`/home/dream/wwwroot/go-starter/projects/multi-database-demo/frontend/src/app.tsx`、`/home/dream/wwwroot/go-starter/projects/multi-database-demo/frontend/src/adapter.ts`。
- 参考公共四表：`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/db/mysql/schemas.ts`。
- 参考业务表：`/home/dream/wwwroot/astro-full-stack-starter/projects/deno-mysql-demo/src/db/schemas.ts`。
- 参考认证及角色：`/home/dream/wwwroot/astro-full-stack-starter/projects/deno-mysql-demo/src/lib/auth.ts`。
- 参考端点／后台配置：`/home/dream/wwwroot/astro-full-stack-starter/projects/deno-mysql-demo/astro.config.mjs`。
- 参考完整 SDL：`/home/dream/wwwroot/astro-full-stack-starter/projects/deno-mysql-demo/src/graphql/generated/admin-schema.graphql`、`/home/dream/wwwroot/astro-full-stack-starter/projects/deno-mysql-demo/src/graphql/generated/member-schema.graphql`。
- 参考公共用户与队列实现：`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/graphql/queries/user.ts`、`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/graphql/mutations/user.ts`、`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/graphql/queries/queue.ts`、`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/graphql/mutations/queue.ts`。
- 参考公共系统页：`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/dashboard/client/pages/user-list.tsx`、`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/dashboard/client/pages/queue.tsx`。

## 店铺列表补齐（2026-10-04）

已补齐 `/admin/shops` 的数据库列表、URL 分页、slug／状态筛选、创建后刷新、加载／空态／错误重试，并沿用参考 `listShops` 参数和排序输入。当前字段沿用 Go Shop 标量模型。详情编辑、删除、完整过滤与关系查询继续归 R3；本批次保留现有迁移历史。验收见 `/home/dream/wwwroot/go-starter/docs/shop-list-verification.md`。

## 2026-10-04 审查修复

- Bus WebSocket 接入共享数据库会话复核，覆盖退出／过期／封禁／角色与权限变更、发送／接收及空闲生命周期。
- 认证限流保留 IP 桶，并将已注册邮箱别名归并到账号 ID 桶；保留旧 MySQL 邮箱匹配语义。
- 店铺创建请求绑定页面卸载，取消客户端等待并忽略迟到成功／失败回调；已完成服务端写入保留。
- 店铺列表／创建拆分为 `shop:list`／`shop:create`；默认 admin／owner 能力保持。

验证记录：`/home/dream/wwwroot/go-starter/docs/code-review-fixes-verification.md`。生产 TLS／代理、真实旧库导入及多进程故障继续按专项验收推进。

## 队列兼容对齐与差异分类（2026-10-06）

| 类别           | 当前规则与进度                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 已对齐         | `updatedAt`／`desc` 最近活动排序；独立详情页面；列表任务／时间／耗时／ID 与序号；recent 状态列；waiting 包含 delayed；历史与成功原任务默认 7 天                                              |
| 平台差异       | BullMQ 与 Asynq 原生状态和任务选项；Asynq `maxRetry` 表示首次执行后的最大重试次数；Go 进程共享并发池，critical／default／low 权重 6／3／1；Node.js 参考按队列配置并发、通过 PM2 提供进程指标 |
| 已确认产品规则 | 每次人工重试安排一次执行，失败后再次归档；原任务 ID 与参数复用，每次执行建立新历史记录；活动任务链持续保留；用户状态采用禁用／启用                                                           |
| 实现待补齐     | 健康和调度操作；消费进程在线与计划监控能力已开启，内存按 Linux RSS 采样                                                                                                                      |
| 收尾优化       | 参考 Node.js 原任务成功／失败按 7 天和数量上限 50 治理；Go 成功原任务默认 7 天，归档／数量规则继续沿用 Asynq，统一在 R6 容量治理评估与完善                                                   |

旧记录保留创建时间后回填活动排序与创建索引，任务链保留时间保持原值；首次列表查询完成剩余回填后分页。当前修改只调整默认配置与新入队默认值，既有显式配置和原任务选项继续生效。验证证据单列于 `/home/dream/wwwroot/go-starter/docs/queue-management-verification.md`。

## 公开 SSR 首批迁移（2026-10-06）

- 首页 `/`：服务端输出页面正文、能力入口、页面元信息；浏览器增强本地计数器与主题切换。
- 队列测试 `/test/queue`：介绍公开，记录读取要求后台访问及 `queue:read`，投递额外要求 `queue:retry`；最近 20 条记录由服务端读取并渲染。
- 测试任务覆盖 critical／default／low 三队列与 success／fail-once／always-fail 三模式，任务投递采用 POST，人工重试沿用已接入的队列后台。
- 本批延续既有数据库迁移版本；其余参考公开测试页列为后续迁移范围。验证记录见 `/home/dream/wwwroot/go-starter/docs/public-ssr-verification.md`。
