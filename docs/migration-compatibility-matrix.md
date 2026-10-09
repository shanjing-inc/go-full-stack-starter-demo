# 迁移兼容矩阵（R0）

参考根目录：`/home/dream/wwwroot/astro-full-stack-starter`。正式实现目录：`/home/dream/wwwroot/go-starter`。

兼容依据为固定源码、锁文件和协议 fixture；实际生产库结构、生产域名与代理拓扑属于环境待验收。旧仓库与五组 POC 保持只读。

## 密码与组合角色兼容修复（2026-10-04）

新密码设置和初始化采用 8–128 个 UTF-8 字节；旧账号登录采用独立 512 字节上限。固定 Better Auth 1.6.24／utils 0.4.2 的 Node 样本覆盖 50 个汉字（150 字节）、128 个汉字（384 字节）、64 个 emoji（256 字节），保留 NFKC、scrypt 参数与旧散列格式。SQLite、真实 MySQL、HTTP 登录及前端完整输入回归共同验证；新密码上限继续保持 128 字节。

角色按逗号边界、完整名称和大小写精确匹配。`HasRole`、双方言管理员存在查询、初始化锁内检查、Guard 与 Dashboard 权限共同支持 `owner,user`、`user,admin` 等组合；子串和大写边界由回归用例覆盖。R2 第一批已接入完整资源／动作权限、用户只读查询与审计输出；用户写操作与会话管理继续迁移。

完整验收从双方言迁移目录读取全部有序版本及最新 head，分别检查 MySQL／SQLite 的迁移登记。验收使用受限认证表 CRUD 账户、真实初始化／登录、Cookie／Bearer 跨实例权限与退出撤销，再执行业务、实时和浏览器回归。各浏览器阶段仅重置本轮临时 Redis 中合成账号与本机 IP 的限流计数；应用限流策略保持原样。

## 功能与协议清单

| 能力                 | 参考证据（相对参考根目录）                                                                   | Go 实现／证据（相对正式根目录，简写按模块定位）                                                               | 状态及后续阶段                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 公共账号四表         | `packages/astro-full-stack-starter/src/db/mysql/schemas.ts`                                  | `packages/go-server-kit/modules/auth/models.go`；应用组合模型、Gen、双方言目标 SQL 与 `202610040001` 增量迁移 | 结构已覆盖，真实旧库快照待验收                                                              |
| 邮箱密码与凭据       | `projects/deno-mysql-demo/src/lib/auth.ts`；锁定 Better Auth 1.6.24、utils 0.4.2             | `modules/auth/password.go`、`service.go`、`fixtures/better-auth-1.6.24.json`；SQLite／MySQL 旧散列登录断言    | R1 已实现核心邮箱路径                                                                       |
| Cookie／Bearer 会话  | 参考 admin、bearer 插件与公共 session 表                                                     | `modules/auth/http.go`、`auth_test.go`；真实双 Web 会话／撤销断言                                             | R1 已覆盖，生产 Cookie 域／TLS 待验收                                                       |
| 首位 owner 初始化    | `projects/deno-mysql-demo/src/pages/replace-with-your-admin-path/install.astro`              | 数据库单例行事务；双独立 Web 并发返回 201／409；SPA `/admin/install`                                          | R1 已实现，新增显式部署密钥保护                                                             |
| 角色与动作权限       | `projects/deno-mysql-demo/src/lib/auth.ts` 中 owner／admin／member／user 与 accessStatements | 公共 `permissions.go`、Guard、PathPermissions、GraphQL 字段门禁、会话权限并集及矩阵回归                       | R2 第一批已覆盖；写操作门禁随后续接口接入                                                   |
| 用户／会话管理       | 参考 UserItem／UserFilters／UserOrderBy、用户查询及 auth admin 插件                          | 公共 `users.go` 与 Admin resolver；公共 `UserList` 页面和应用 adapter                                         | R2 第一批完成只读三查询及列表；写操作／所有权／会话待迁移                                   |
| Shop／Product／Order | `projects/deno-mysql-demo/src/db`；参考双 SDL                                                | `internal/model/shop.go`、`schema/*.graphqls`、`internal/fixtures/reference-*.graphql`                        | Shop 子集已覆盖，完整模型／CRUD／关系／金额／分页归 R3                                      |
| REST／双 GraphQL     | 参考 API 路由与完整 SDL                                                                      | `/api/graphql/member`、`/api/graphql/admin`、Shop REST；既有 golden fixture                                   | 已覆盖协议子集；全量字段／过滤／排序归 R3                                                   |
| Asynq／调度执行      | 原 BullMQ／Worker 任务与调度清单                                                             | `infra/queue`、`infra/schedule`、`internal/tasks`、`poc/worker/fixtures/reference-inventory.json`             | 执行基础已覆盖；R4 首批概览／记录／单次重试已接入，计划监控已接入，健康／调度操作待后续批次 |
| Dashboard            | 参考后台布局、登录／初始化、系统与业务页                                                     | `packages/shadcnui-dashboard`；应用登录／初始化／退出／概览／Shop／公共用户列表与 E2E                         | 身份与用户管理、R4 首批队列页已接入；计划监控已接入，健康／调度操作／完整业务页归后续批次   |
| Bus WS／SSE          | 原 Bus 查询／广播消息及路由                                                                  | `internal/realtime/fixtures/reference-cases.json`、协议与真实双进程故障测试                                   | 消息与流回归已覆盖；R1 加入握手／请求鉴权                                                   |
| 通用 WS／public SSE  | `projects/deno-mysql-demo/astro.config.mjs` 注册的 public／member／admin 连接                | 公共 ws／sse transport 已完成，专用 Bus 入口已接入                                                            | 通用路由、标准推送与客户端生命周期归 R5                                                     |
| Cache／关联查询      | 参考 Redis Cache 与 GraphQL 关系解析                                                         | 公共 Cache／Lease／Bus 已完成；参考 SDL 关系保留                                                              | 批查询／请求级缓存及业务缓存示例归 R3、R5                                                   |
| 日志与错误观测       | 参考 Sentry、request ID 与业务错误公开规则                                                   | slog、HTTP／GraphQL 错误公开规则、用户查询／权限拒绝审计、actor／request ID 关联                              | R2 第一批审计输出已覆盖；写操作审计、存储保留与 Sentry 继续接入                             |
| 团队交付             | 原 Web／Worker、私有公共包与模板导出                                                         | 静态双二进制、内嵌 SPA、Dockerfile、开发监管与生成命令                                                        | 本地已覆盖；容器、TLS、远程依赖／发布归 R6                                                  |
| 手机号能力           | 用户确认延期范围                                                                             | 保留邮箱专用模型与界面                                                                                        | 范围外：手机号登录、短信验证码、绑定与新增字段                                              |

## 数据库兼容差异

### 认证表

保留四表名称、signed `int` 自增 ID、邮箱唯一索引、provider／account 联合唯一索引、user_id 索引、nullable 字段、布尔默认值、DATETIME 默认值与 MySQL 更新时间行为。session／account 保留删除用户时级联删除的外键。`auth_bootstrap` 为新增单例锁表，迁移插入固定 ID=1。

迁移策略以既有兼容事实优先：认证表沿用历史索引命名、signed ID、布尔列名和级联外键；公司通用 schema 命名约定通过后续业务表采用。

旧 DATETIME 编解码取决于参考应用的 `TZ`。Go MySQL DSN 的 `parseTime=true` 和 `loc`、数据库会话时区应与存储墙上时间一致。当前集成库验证 UTC；真实旧库切换前核对 TZ／DSN／数据库时区，并使用已知过期时间样本验证。已有数据转 UTC 时由独立审核迁移完成转换。

### Shop 与完整业务模型

| 项目       | 当前样例                      | 参考契约                              | 处理阶段                  |
| ---------- | ----------------------------- | ------------------------------------- | ------------------------- |
| ID         | signed bigint                 | signed int                            | R3；先审查真实 ID 范围    |
| 状态       | active／inactive，默认 active | draft／active／archived，默认 draft   | R3；保留旧值并定义转换    |
| 索引       | uk_slug／idx_status           | shop_slug_unique／shop_status_idx     | R3；独立增量迁移          |
| 时间       | 当前 GORM datetime 写入       | zonedDateTime 默认值／更新行为        | R3；时区夹具与真实 MySQL  |
| 关系／金额 | Shop 样例                     | Product／Order 外键、分单位金额与关系 | R3；完整 SDL 与旧数据夹具 |

本批次维持 Shop 样例契约，认证通过新增应用迁移组合进入。

## 三条数据库落地路径

1. **全新库**：执行当前 mysql／sqlite 全部版本化迁移，先建立 Shop，再建立认证表与初始化锁行；启动 gate 期望版本 `202610040001`。
2. **已有 Go 示例库**：保持 `202610030001_initial.sql` 与原 checksum 条目，应用新增 `202610040001_email_auth.sql`，更新环境 DB_VERSION 后启动。
3. **真实旧库**：先导出完整 schema 与匿名化数据、索引／外键／时区；建立专用 baseline 和旧库升级迁移目录；认证四表按已有结构沿用，新增初始化锁表。Shop 差异与 R3 一起审核。当前 demo 迁移目录用于 Go 示例库和新库，旧库上线使用审核后的专用迁移目录与版本登记。

现有四表数据库执行 demo 的建表迁移会触发重复表错误。切换操作先完成 baseline／schema diff／备份恢复演练，保留显式人工审核关口。

## R1 认证边界

核心接口为邮箱登录、查询会话、退出及部署密钥控制的初始化。新账号密码长度 8–128 字节，旧账号验证保持参考散列及 NFKC 规范化；采用固定参数的 scrypt 与恒定时间比较。每进程限制四个并发派生，共享 Redis 分别限制连接 IP 与规范化邮箱；错误均脱敏。

保留旧 session.token 原文存储及 Cookie HMAC-SHA256 格式。迁移保留登录态需一致密钥、Cookie 名／域策略和时区；更换密钥／Cookie 策略或选择强制重登时，由切换流程显式撤销旧会话。Go 使用数据库会话作为身份来源，默认有效期七天，距离上次更新一天后滚动续期；退出立即删除该会话行。

本批次登录 UI 采用默认会话策略。Better Auth 全部插件／SDK 动作、rememberMe／callbackURL 选项、邮件验证／找回密码、OAuth、模拟登录和跨子域 Cookie 策略按后续专项锁定；初始化负责首位 owner 建立。权限矩阵和用户只读查询已在 R2 第一批接入；创建／更新用户和撤销用户全部会话已在 R2 第二批接入；会话列表与单会话撤销已在 R2 第三批接入；所有权转移继续按后续批次实施；密码修改／重置延后至 R6 最终收尾。用户删除列为范围外，用户状态管理采用禁用／启用。

Web／GraphQL／Bus WS 握手／SSE 请求共享已校验的身份 context。Bus WebSocket 在发送、输入处理及默认 500 毫秒空闲周期复核共享数据库；退出、过期、封禁、角色／权限变更及数据库复核失败结束连接并清理设备 presence。复核超时为 3 秒，数据库读延迟及复核到发送之间的并发窗口纳入生产验收；WebSocket 复核沿用数据库有效期，HTTP 请求保留滑动续期。SSE 查询继续按 HTTP 截止／取消生命周期结束。

本轮权限改进为 `shop:create` 增加独立写门禁。默认 owner／admin 保留店铺创建能力，自定义只读角色持有 `shop:list` 时仅可读取；前端隐藏创建入口，GraphQL mutation 执行写门禁。邮箱限流按登录查询匹配到的账号 ID 计数，大小写／重音别名共享额度；未知邮箱保留规范化邮箱桶，IP 桶保持每分钟 20 次。

## 验收入口

- `rtk pnpm verify`：隔离 MySQL／Redis、完整 Go 单测、受限数据库账号、双 Web、Worker、旧散列读写、初始化互斥、Cookie／Bearer、原实时故障与浏览器／HMR 回归。
- `packages/go-server-kit/modules/auth/auth_test.go`：密码／散列、初始化回滚和并发、刷新／过期／封禁／撤销、HTTP 身份／权限／Origin／CORS、Redis 限流及错误脱敏。
- `projects/multi-database-demo/internal/schema/export_test.go`：signed int、默认值、索引、外键和 Provider 生命周期断言。
- `docs/auth-migration-verification.md`：最终本地验收结果及生产待验证清单。

## 店铺列表增量（2026-10-04）

`/admin/shops` 使用 `listShops(limit: Int, offset: Int, orderBy: ShopOrderBy, where: ShopFilters): [ShopItem!]`，沿用参考参数类型、可空性与 `InnerOrder(direction, priority)`。支持现有 Shop 标量、id／status eq、slug eq／like、六字段排序及存储层分页。服务端默认 20 条，最大 101 条；前端采用多读一条的上一页／下一页模式。同时间排序附加 ID 降序保证确定性。完整操作符、详情 CRUD、产品／订单关联及旧库模型对齐继续归 R3。

## R2 第一批增量（2026-10-04）

公共 auth 接入可配置角色／资源／动作权限、路径授权、用户三项只读查询和查询审计；公共 Dashboard 接入只读用户列表，应用负责 GraphQL 传输与服务组装。Admin SDL 的用户字段、筛选和排序类型与固定参考 fixture 逐字段比对通过。用户写操作、所有权保护及会话管理进入下一批，手机号继续延期。

本批最终通过 18 项完整流程、365 条 Go 父／子用例记录、10 项公共 UI 单测及生产／开发双浏览器各 26 项。实时查询截止竞态修复另经 30 轮隔离 Redis 回归。完整证据、失败轮记录与人工验收步骤见 `/home/dream/wwwroot/go-starter/docs/user-query-verification.md`，最终报告为 `.runtime/project-73s6bfhy/result.json`。Docker／race／真实旧库及生产 TLS／代理保持 pending。

### 后台身份读取与请求边界（2026-10-04）

当前后台通过一次 GraphQL `getDashboardSession` 合并现有 `getCurrentUser` 与新增 `getCurrentPermissions` 字段。应用共享会话贯通路由守卫、侧栏和用户页；内部切页仅查询业务数据。角色权限与应用菜单别名共用 auth 的 `DashboardPermissions`，兼容 REST session 接口保持原有字段和认证方式。

登录／初始化／退出沿用既有 HTTP 认证接口。统一请求层处理 HTTP／GraphQL 认证失效、权限拒绝、封禁及服务故障；登录回跳仅接受本站后台地址。焦点恢复按 60 秒有效期复核权限；服务端 API 继续逐请求校验会话与资源动作。具体计数、兼容和验证范围见 `/home/dream/wwwroot/go-starter/docs/user-query-verification.md` 第 8 节。

审查修复与回归范围参见 `/home/dream/wwwroot/go-starter/docs/code-review-fixes-verification.md`。

## R2 用户管理写操作（2026-10-05）

- `createUser(set)`／`updateUser(set, where)` 沿用参考字段名及 `[UserItem!]!` 返回形状；更新开放名称、角色与封禁字段，未知输入字段由 GraphQL 校验拒绝。创建邮箱采用现有规范化规则，密码沿用 NFKC＋scrypt 与 8–128 UTF-8 字节门禁。
- `banReason`／`banExpires` 区分省略与显式 null；省略保留现值，null 清空。解封统一清空原因与到期；设置到期要求未来时间。写筛选要求有效条件，空 NOT IN 保持查询范围并计为零个有效条件；单批最多 100 用户。
- 字段权限为 `user:create`、`user:update`、`user:set-role`、`user:ban`。事务内重读操作者并复核封禁／最新权限；目标角色及账号权限必须处于操作者授权范围内。组合角色排序去重，直接分配 owner 或具备 `system:owner` 的角色进入所有权转移范围。
- owner 账号管理由持有 owner 角色及 `system:owner` 的操作者执行；当前账号保留自身角色及有效登录能力，最后可用 owner 按 owner 完整角色及有效封禁状态判断。owner 角色变更延期；本批保留既有凭据结构。
- Go 扩展 `revokeUserSessions(userId: ID!): Boolean!` 要求 `session:revoke`，成功删除目标全部会话，重复操作成功。封禁和实际角色变更与撤销会话同事务；名称更新保留会话。`auth_bootstrap(id=1)` 串行化用户管理及登录会话写入，保留现有迁移版本 `202610040001`。
- 管理操作记录结构化审计；存储及保留周期由 sink／部署配置。已完成请求和帧沿用当前协议；后续 HTTP／WS 复核共享数据库会话。封禁不阻止到期或解封后的新登录，撤销保留使用正确凭据重新登录的能力。

## R2 会话管理增量

- Go Admin GraphQL 扩展 `listUserSessions(userId: ID!, limit: Int, offset: Int): [UserSessionItem!]!` 与 `revokeUserSession(userId: ID!, sessionId: ID!): Boolean!`。现有 `revokeUserSessions` 保持全部撤销语义；参考用户查询、创建与更新的字段兼容断言继续执行。
- `UserSessionItem` 返回会话／用户 ID、IP、User-Agent、创建／更新／到期时间和 `current`。查询显式选取安全字段；token 保留在认证模块内部。Cookie 与 Bearer 请求通过 Guard 中的会话 ID 确认当前会话，沿用秒级 UTC DateTime 输出。
- 查询仅返回有效期内会话，默认 20 条、最多 101 条，offset 为 0–1000000；按创建时间及 ID 倒序。MySQL 在数据库执行筛选及分页。SQLite 快速测试读取目标用户安全投影后，按 Go 绝对时间筛选、排序及分页，兼容旧 RFC3339 和驱动时区文本。
- 列表与撤销分别要求 `session:list`／`session:revoke`，重新读取操作者角色与封禁状态，并校验目标用户授权范围及 owner 保护。单撤销按 `user_id + id` 限定，重复撤销成功，其他用户和其他会话保持有效。管理写入沿用 `auth_bootstrap` 事务锁。
- 公共 Dashboard 新增可选 `getUserSessions`／`revokeUserSession` 适配器。用户行“查看会话”支持 10／20／50 条分页、刷新、当前会话提示和二次确认；撤销当前会话触发共享身份刷新。关闭／切页取消请求，错误留在弹窗，关闭后恢复菜单焦点。
- 审计使用 `session/list` 与 `session/revoke-one`，目标分别为用户 ID 和 `用户ID/会话ID`。生产审计落地及保留周期继续由部署配置。完整证据见 `/home/dream/wwwroot/go-starter/docs/session-management-verification.md`。

## 用户状态管理范围决定（2026-10-06）

- 用户账号仅支持禁用／启用，账号、凭据及关联业务数据持续保留。后台与 API 禁止删除用户，参考 `deleteUser` 列为范围外。
- 复用现有 `banned`／`banReason`／`banExpires` 字段和 `user:ban` 权限；现有界面“封禁／解封”承接禁用／启用语义。
- 禁用与撤销该用户全部会话在同一事务完成；后续 HTTP／WS 复核感知失效。启用后通过正常登录建立新会话，自禁用限制及最后可用 owner 保护继续生效。
- 既有 session／account 外键与迁移版本保持原状，数据库级联约束作为结构兼容项保留；本项决定约束产品操作及 API 暴露范围。

## 密码管理优先级决定（2026-10-06）

- 用户自行修改密码、管理员重置及后台入口统一延后至 R6 最终收尾；R3–R5 沿用现有认证／权限基线。
- 创建用户时设置初始密码、现有密码长度校验、散列兼容及会话管理继续保留。
- 首次登录强制改密、管理员密码复核、统一重新登录及密码强度调整为收尾阶段待确认建议；具体实现与验收规则届时锁定。

## R4 队列存储与收尾优化决定（2026-10-06）

- 首批执行记录沿用参考 Node.js 的 Redis 存储方案，手动重试操作审计一并保存在 Redis；独立键命名空间隔离 Asynq 原任务与记录／审计。
- Asynq 原任务的保留与归档清理遵循原生规则；手动重试复用仍存在的原任务，每次创建独立执行记录。原任务清理后，历史记录继续可查，重试入口禁用并提示原因。
- 独立执行记录默认保留 7 天，时长可配置；未结束重试链的关联记录持续保留。
- Redis 内存与持久化磁盘容量、快照／索引／清理策略优化及 MySQL 历史记录存储评估统一安排至 R6 最终收尾，依据实测再确认调整方案；首批保持 Redis 存储。
- R4 首批 Redis 执行记录、重试审计和公共队列页面已落地；测试与真实依赖验收范围见 `/home/dream/wwwroot/go-starter/docs/queue-management-verification.md`。容量评估与存储优化保持 R6 收尾待办。

## 队列导航兼容补齐（2026-10-06）

- “队列管理”分组按参考顺序展示控制台、最近任务、运行中任务、已完成任务、失败任务、等待任务、计划任务；所有入口继承 `queue:read`。
- 控制台 `/admin/queues`，各状态列表 `/admin/queues/jobs/:status`，详情 `/admin/queues/jobs/:status/:recordId`；详情保留所属列表的标题与菜单活跃状态。
- recent 汇总各状态记录，all 保留旧调用兼容；waiting 合并待执行与延迟状态索引，delayed 保留单独筛选。
- 首批 `/admin/queue` 及查询参数详情链接兼容跳转，筛选、分页与历史访问继续保留；单次重试跳转新执行记录的状态路径。
- 计划任务 `/admin/queues/schedules` 已接入 `getQueueSchedules`，展示代码定义、共享启用状态、下次执行、最近派发、Leader 和调度器心跳。页面沿用 Node.js 只读范围，默认停用计划的下次执行为空。导航补齐验证证据单列于 `/home/dream/wwwroot/go-starter/docs/queue-management-verification.md`。

## 队列兼容对齐与差异分类（2026-10-06）

| 类别           | 当前规则与进度                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 已对齐         | `updatedAt`／`desc` 最近活动排序；独立详情页面；列表任务／时间／耗时／ID 与序号；recent 状态列；waiting 包含 delayed；历史与成功原任务默认 7 天                                              |
| 平台差异       | BullMQ 与 Asynq 原生状态和任务选项；Asynq `maxRetry` 表示首次执行后的最大重试次数；Go 进程共享并发池，critical／default／low 权重 6／3／1；Node.js 参考按队列配置并发、通过 PM2 提供进程指标 |
| 已确认产品规则 | 每次人工重试安排一次执行，失败后再次归档；原任务 ID 与参数复用，每次执行建立新历史记录；活动任务链持续保留；用户状态采用禁用／启用                                                           |
| 实现待补齐     | 健康和调度操作；消费进程在线与计划监控能力已开启，内存按 Linux RSS 采样                                                                                                                      |
| 收尾优化       | 参考 Node.js 原任务成功／失败按 7 天和数量上限 50 治理；Go 成功原任务默认 7 天，归档／数量规则继续沿用 Asynq，统一在 R6 容量治理评估与完善                                                   |

旧记录保留创建时间后回填活动排序与创建索引，任务链保留时间保持原值；首次列表查询完成剩余回填后分页。当前修改只调整默认配置与新入队默认值，既有显式配置和原任务选项继续生效。验证证据单列于 `/home/dream/wwwroot/go-starter/docs/queue-management-verification.md`。

## 公开 SSR 首页与队列测试（2026-10-06）

| 能力       | 参考行为                                           | 本批 Go 行为                                                                                          |
| ---------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 首页       | Astro SSR 正文、能力入口、浏览器计数器和主题       | Echo + html/template SSR，展示队列测试与后台入口，计数器和主题采用轻量浏览器脚本                      |
| 队列测试   | 三队列、三失败模式、最近任务                       | critical／default／low，权重 6／3／1；success／fail-once／always-fail；最近 20 条独立演示任务记录 SSR |
| 投递入口   | GET action 触发测试投递                            | POST `/api/rest/demo/queue-test`，权限、来源和载荷校验；GET 仅显示页面                                |
| 人工重试   | fail-once 首次失败后人工重试，always-fail 持续失败 | 共用现有后台重试，fail-once 首次失败标记保留 1 小时，三模式均使用独立 `demo:queue-test` 类型          |
| 资源与后台 | SSR 公开页和后台 SPA 分开承载                      | Vite 多入口共享 Tailwind 样式，Go 内嵌 manifest 与资源，`/admin/*` 保持 SPA                           |

本批验收范围与证据见 `/home/dream/wwwroot/go-starter/docs/public-ssr-verification.md`。其他公开测试页、健康与调度操作仍按对应后续范围推进。
