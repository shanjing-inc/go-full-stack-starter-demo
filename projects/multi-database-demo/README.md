# 多数据库示例应用

展示业务应用如何组合 `go-server-kit` 与 `@shanjing/shadcnui-dashboard`，拥有自己的模型、代码生成配置、最终迁移、业务服务与两个运行入口。

工程目录与后台展示名称使用 `multi-database-demo`／`Multi Database Demo`。数据库名由连接 URL 决定；默认 `APP_NAMESPACE=go-mysql-demo` 沿用既有 Redis 队列、幂等与调度数据。浏览器偏好键沿用 `go-mysql-demo`，主题与字号继续读取既有设置。现用 `.env` 随目录移动并保持内容，历史迁移、checksum、目标 SQL 和 GraphQL SDL 保持原字节。

## Trellis 与项目复用

本应用已提供 `.trellis/` 和 `AGENTS.md`，从本目录运行 `rtk proxy python3 .trellis/scripts/get_context.py --mode packages`、`rtk proxy python3 .trellis/scripts/task.py current --source`。开发前读 `.trellis/spec/index.md`，复用替换清单见 `.trellis/spec/guides/reuse-guide.md`。

本目录管理应用任务，共享包/工具/发布任务在工作区根管理，不建两份记录。独立 demo 发布保留完整源码工作区，构建命令在含 `go.work` 的工作区根运行；上游任务、日志、身份和平台配置不随发布。规范与代码同步更新。

## 工程结构

```text
cmd/                 web、worker、gen、schema
internal/
  config/            应用配置、运行模式与认证密钥
  graph/             双 GraphQL 生成代码、resolver、标量与过滤适配
  model/             应用组合模型
  query/             Gen 生成查询
  service/           业务 Service 与单测替身
  realtime/          设备查询、广播与流生命周期
  protocol/          应用实时消息协议
  pages/             公开 SSR 布局、首页、队列测试模板与主题脚本
  tasks/             应用 task type、载荷、幂等副作用与调度定义
schema/              SDL 与三个方言的目标 SQL
migrations/          mysql／postgres／sqlite 最终版本化 SQL 与 atlas.sum
frontend/            菜单、路由、概览、店铺页面与 adapter
webui/               Vite 多入口资源、manifest 内嵌与 SPA 托管
```

## 多数据库配置

同一份业务代码支持 MySQL、PostgreSQL 与 SQLite。默认配置统一采用 `.env.example` → `.env`，数据库类型由 `DB_DSN` 的 `mysql://`、`postgres://`、`postgresql://`、`sqlite://` 协议推导。MySQL URL 转换为驱动 DSN，默认开启 `parseTime` 并使用 UTC；用户名、密码中的非 ASCII 字符与保留字符使用 URL 百分号编码。从仓库根执行 `pnpm dev`、`pnpm migrate`、`pnpm schema:diff`，迁移目录与目标 SQL 自动跟随连接协议。`MIGRATION_URL`、`ATLAS_DEV_URL` 与运行连接保持数据库类型一致；`--env-file` 支持验收与部署指定路径。PostgreSQL diff 自动移除开发 URL 的 `search_path`，以数据库级清理覆盖自定义排序规则；`ATLAS_DEV_URL` 需指向全部 schema 均可清空的独立开发库。

- MySQL 保留 InnoDB、`utf8mb4_unicode_ci` 与既有迁移，SQLite 服务快速测试。
- PostgreSQL 要求 18+ 和 ICU，`starter_unicode_ci` 使用 `und-u-ks-level1`、`deterministic=false`，覆盖邮箱与 slug 的大小写／重音等价、唯一约束与 `LIKE` 查询。管理员角色候选使用 `COLLATE "C"`，保持严格 token 与大小写权限边界。
- 时间字段采用 Go `time.Time`，MySQL 映射 `datetime`，PostgreSQL 映射 `timestamptz`，连接示例固定 UTC。应用 ORM 维护 PostgreSQL 的 `updatedAt`，直接 SQL 写入需同步维护时间。
- PostgreSQL revision 表固定在 `public`。迁移账户管理 DDL、排序规则与序列；Web 账户拥有业务表读写、序列 `USAGE/SELECT`、schema `USAGE` 与 revision 表只读；当前 Worker 账户拥有业务表与 revision 表只读权限。

GraphQL／Gen 各生成一套代码，schema 导出分别启动进程生成 `mysql.sql`、`postgres.sql`、`sqlite.sql`。两种数据库共用 `bin/web`、`bin/worker` 与同一 Dockerfile，部署时由配置选择数据库。

## 启动与运行

从仓库根目录执行 `pnpm setup`、复制并填写本应用 `.env`、`pnpm generate`、`pnpm migrate`、`pnpm dev`。Web 与 Worker 启动前检查数据库版本和 Redis；readiness 持续检查版本与 Redis。

| 路径                            | 功能                           |
| ------------------------------- | ------------------------------ |
| `/api/graphql/member`           | Member Schema 查询             |
| `/api/graphql/admin`            | Admin 店铺查询、列表与创建     |
| `/api/rest/demo/shops/:id`      | 同一 Service 的店铺 REST 读取  |
| `/api/rest/demo/overview`       | 数据库店铺计数                 |
| `/api/rest/demo/session`        | 兼容身份接口，后台使用 GraphQL |
| `/api/rest/demo/tasks`          | Asynq 示例任务投递             |
| `/api/rest/demo/build`          | 开发重建诊断                   |
| `/api/rest/bus/query`           | 设备在线查询与 SSE 结果流      |
| `/api/rest/bus/broadcast`       | 跨实例广播                     |
| `/api/websocket/bus-query`      | 设备消息连接                   |
| `/api/websocket/bus-broadcast`  | 广播订阅连接                   |
| `/health/live`、`/health/ready` | 存活与依赖／版本就绪           |
| `/admin/`                       | 后台 SPA，支持深链刷新         |

`/api/rest/poc/*` 诊断与旧测试路径保留为兼容别名。已有双 GraphQL SDL、错误公开规则与实时 v1 信封延续 POC 兼容基线。单条查询实现 `eq` 子集；店铺列表支持 id／status 的 `eq`、slug 的 `eq`／`like`、排序及分页。其余过滤操作返回明确范围错误，旧业务全量过滤与数据模型进入后续接入专项。

## 数据库

`shop` 为业务示例表：signed bigint 自增主键、名称／slug／状态、创建与更新时间；MySQL InnoDB、utf8mb4_unicode_ci、`uk_slug` 和 `idx_status`。主键使用 Go int 以对接既有 GraphQL 服务接口，signed 类型与字符串状态属于样例兼容选择；真实旧表导入按数据库快照审核。

迁移文件由应用维护。初版版本 `202610030001`，当前认证增量版本 `202610040001`；MySQL、PostgreSQL 与 SQLite 各自维护 SQL 与 checksum。测试中的 `AutoMigrate` 限于隔离 ORM 测试库，应用入口通过只读门禁连接已迁移数据库。

## 任务和调度

`demo:effect` 将同一业务键的副作用计数一次，Redis Lua 原子记录幂等标记与计数。默认代码调度每分钟一次，初始关闭；共享启停／Leader 租约封装在公共基础设施中。持久化幂等存储、清理策略和真实业务副作用在业务模块接入时定义。

## 当前边界

- `APP_MODE` 显式选择 development／production，Web 需要认证密钥和精确 Origin 白名单。
- `/admin/login` 为邮箱登录，`/admin/install` 用显式部署密钥初始化 owner；退出立即撤销数据库会话。
- REST／GraphQL／Bus 握手与 SSE 请求共享身份；R2 已接入资源权限、用户查询和第二批管理写操作，剩余动作按迁移规划推进。
- Dockerfile 已提供同镜像 Web／Worker 交付定义；2026-10-05 已通过正式多阶段构建与依赖容器拓扑 14 项流程验收，离线容器运行 13 项流程验收通过。生产 TLS／Cookie 域与代理拓扑继续独立验收。
- 公共依赖采用本地 workspace／replace；发布后的远程版本组合单独验收。

公共认证接口、数据库旧库切换及验证边界见 `/home/dream/wwwroot/go-starter/docs/migration-compatibility-matrix.md`。

## Docker 部署验收

在仓库根目录运行 `rtk pnpm verify:docker`，验证正式多阶段构建、隔离 MySQL／Redis 容器、双 Web 与 Worker。`rtk pnpm verify:docker --runtime-only` 从宿主机当前源码构建静态程序和 SPA，复用正式 Dockerfile 的最终运行阶段，连接脚本拥有的隔离宿主机依赖。

本机宿主代理为 `http://127.0.0.1:7897`，完整验收可执行 `rtk proxy pnpm verify:docker --build-proxy http://127.0.0.1:7897 --pull-timeout 300`；Docker daemon 代理独立配置，详见验证文档。

两种模式分别写入 `/home/dream/wwwroot/go-starter/.runtime/project-docker-result.json` 与 `/home/dream/wwwroot/go-starter/.runtime/project-docker-runtime-result.json`；运行阶段报告保留完整构建与依赖容器待验收项。脚本回归入口为 `rtk pnpm test:docker-verifier`，同时接入 `pnpm test`。命令、资源清理与实测边界见 [Docker 部署验证](/home/dream/wwwroot/go-starter/docs/docker-deployment-verification.md)。

## 店铺列表验收

登录后访问 `/admin/shops`，侧栏入口为“店铺列表”。页面读取数据库已有记录，显示 ID、名称、唯一标识、启停状态、创建时间及更新时间；默认创建时间降序，同时间记录使用 ID 降序。

页面沿用 Node.js 版的独立标题区、紧凑筛选栏、带边框表格与分页栏，状态使用徽标，时间使用统一格式。创建入口打开右侧抽屉，移动端使用全宽抽屉。

1. 刷新页面，已有店铺继续显示；使用“刷新列表”读取外部更新。
2. 按唯一标识模糊筛选及启停状态筛选，使用“重置”恢复全部记录。
3. 每页支持 10／20／50 条，使用上一页／下一页切换。页码、每页条数和筛选保存至 URL，刷新与浏览器历史保持一致。
4. 点击“创建店铺”，在右侧抽屉填写名称与唯一标识并提交。成功后关闭抽屉、回第一页、清除筛选并重新读取列表；重复唯一标识显示业务错误。
5. 列表请求失败时显示错误与“重试”；加载中显示提示，空结果显示“暂无匹配的店铺”。

GraphQL 使用参考项目的 `listShops(where, limit, offset, orderBy)` 协议。默认 limit=20，允许 0–101 条、offset≥0；前端额外读取一条判断下一页，页面展示本页数量。当前数据状态为 active／inactive，详情编辑、删除及产品／订单关联归 R3 后续范围。本次功能延续现有数据库模型和迁移版本。

隔离验证及验收记录见 `/home/dream/wwwroot/go-starter/docs/shop-list-verification.md`。

## 用户列表验收（R2 第一批）

1. 登录 owner／admin，打开 `/admin/users` 或左侧“用户列表”；检查姓名／邮箱／角色／验证／封禁及时间字段。
2. 使用邮箱包含、角色、状态和邮箱验证筛选，检查刷新／后退后的 URL 状态。
3. 每页切换 10／20／50 条；结果超过一页时检查前后翻页，空结果显示“暂无用户记录”。
4. 通过受限角色直达页面时显示 403；直接 GraphQL 请求按后台访问和字段资源动作分别校验。

Admin GraphQL 新增参考 `getCurrentUser`、`getUser(where)` 与 `listUsers(where, limit, offset, orderBy)`。应用负责协议转换，公共 auth 模块提供查询和权限，公共 Dashboard 提供可复用列表与管理操作。第二批接入 `createUser`／`updateUser` 及 `revokeUserSessions`；数据库迁移版本保持 `202610040001`。删除用户、完整密码管理、所有权转移及会话列表继续按后续范围推进。

验收记录见 `/home/dream/wwwroot/go-starter/docs/user-query-verification.md`。后续开发直接使用 develop，提交按用户单次授权执行。

## 后台共享会话与请求验收

后台首次进入时通过一次 `getDashboardSession` GraphQL operation 合并查询 `getCurrentUser` 与 `getCurrentPermissions`。应用 `SessionProvider` 持有身份，路由守卫、侧栏与用户列表共享权限；公共 Dashboard 的可选 `session` 属性支持应用控制会话，原 adapter 加载方式保持兼容。角色权限与应用 `demo:read`／`demo:write` 菜单别名通过公共 auth 的 `DashboardPermissions` 去重、排序并统一返回。

- 侧栏切到用户／店铺列表：对应列表 GraphQL 各一次，身份查询增量为 0。筛选、分页与刷新沿用当前身份；整页刷新重新查询一次身份。
- 恢复窗口焦点：距上次身份验证达到 60 秒时复核，并发复核合并；业务 403 主动复核自身权限并同步菜单。服务端每次 API 请求继续解析数据库会话并执行授权。
- HTTP 401 与 GraphQL `UNAUTHORIZED`／`UNAUTHENTICATED`：清理身份、取消进行中的后台请求，跳转登录并记录当前路径、查询参数与 hash。登录回跳限制在本站后台，外部地址、后台外路径和认证页回到系统概览。
- 403：显示权限提示；`USER_BANNED` 清理后台并显示封禁提示。503／网络故障：显示错误与重试，后台复核失败保留现有身份。
- 登录、退出和初始化继续走 `/api/auth/*`；`/api/rest/demo/session` 保留为兼容接口。

浏览器验收：登录后打开 Network，刷新 `/admin/users`，检查一次 `getDashboardSession` 与一次 `dashboardUsers`；清空网络记录并切到“店铺列表”，检查一次 `listAdminShops`。接口与错误回归记录见 `/home/dream/wwwroot/go-starter/docs/user-query-verification.md` 第 8 节。

## 用户管理验收（R2 第二批）

在 `/admin/users` 使用“创建用户”，输入名称、邮箱、初始密码和 member／admin／user 角色。新密码按 8–128 UTF-8 字节校验，创建成功后列表重新读取。通过账号行操作编辑名称／角色、封禁／解封、撤销全部会话；失败提示保留在操作弹窗。

1. 新建账号使用设置的邮箱密码登录；重复邮箱显示“邮箱已存在”。新账号邮箱验证状态为未验证。
2. 编辑名称后，已有会话继续使用并读取最新名称。实际角色变更后，目标用户已有会话失效。
3. 封禁时可填写原因及到期，留空表示长期封禁；已有会话撤销，封禁期间登录显示受控封禁错误。解封清空原因／到期，并允许重新登录。
4. 撤销其他用户全部会话，目标已有设备退出，当前管理员身份缓存保持。撤销自身会话后自动回到登录页。
5. admin 管理 owner 时由页面和服务端收敛权限；自身封禁／角色调整入口隐藏。直接 API 仍按字段权限、最新数据库角色及授权范围校验。
6. 打开 Network，操作其他用户成功后增量为一次 mutation、一次 `listUsers`，共享身份查询增量为 0；切页或关闭弹窗取消等待，已完成写入保留。

开发继续在 develop，提交按单次授权执行。隔离验证证据和环境边界见 `/home/dream/wwwroot/go-starter/docs/user-management-verification.md`。

## 队列管理首批

后台“队列管理”分组按 Node.js 顺序提供控制台、最近任务、运行中任务、已完成任务、失败任务、等待任务、计划任务。控制台 `/admin/queues`、列表 `/admin/queues/jobs/:status` 和详情 `/admin/queues/jobs/:status/:recordId` 接入公共 `QueuePage`；旧 `/admin/queue` 地址自动迁移，并保留筛选、页码和详情记录。计划页 `/admin/queues/schedules` 接入公共 `QueueSchedulesPage` 与 `getQueueSchedules`，只读展示计划定义、共享启用状态、下次执行、最近派发结果、Leader 与调度器心跳。示例 `demo-tick` 默认停用，下次执行显示为空。

服务端组装 `modules/queue`；owner／admin 默认拥有 `queue:read` 与 `queue:retry`。自定义只读角色配置 `queue:read`，人工重试同时要求两项权限。

Admin GraphQL 接入 `getQueueDashboard`、`getQueueSchedules`、`getQueueExecutionRecord`、`listQueueExecutionRecords`、`updateQueueExecutionRecord`。沿用参考 Node.js 的操作名称、主要参数和 Unix 毫秒时间；新增递增执行序号、关联记录、重试能力及禁用原因。列表以 `updatedAt`／`desc` 请求，按最近活动时间及 ID 倒序排列；支持 `sortAt`／`createdAt` 和双向排序。waiting 合并待执行与延迟记录。详情使用独立页面，返回来源列表时保留筛选与分页。

Web／Worker 共用 `QUEUE_RECORD_RETENTION_DAYS`，默认 7 天，范围 1–365。人工重试复用 Asynq 原任务并新建执行记录，每次只执行一次；活动链持续保留，过期历史与操作审计由 Worker 每分钟维护。配置同一 Redis 与 namespace 保持执行链一致。

健康详情、调度启停／人工触发操作及手动清理入口留后续批次，Redis 容量优化记录于 R6。测试证据见 `/home/dream/wwwroot/go-starter/docs/queue-management-verification.md`。

平台差异与后续范围统一记录于队列验收文档。Go 共享并发池与 6／3／1 消费权重、Asynq 自动重试／归档规则，调度器与消费进程在线分别展示，Worker 每 3 秒采样 Linux RSS，配置数量与硬内存上限由部署环境管理。成功原任务默认保留 7 天；已入队任务保留原配置，Node.js 的原任务数量上限 50 与归档时间治理归收尾容量优化。

## 公开 SSR 首页与队列测试

开发入口为 `http://127.0.0.1:5173/` 与 `/test/queue`，Vite 将公开页及构建资源代理到 Go；Go 直接访问入口为 `http://127.0.0.1:8080/` 与 `/test/queue`。后台保持 `/admin/`。首页与队列正文、最近执行记录由 Go `html/template` 渲染，浏览器脚本增强主题、计数器和任务投递。

队列测试页介绍公开可读。记录读取要求 `dashboard:access:admin` 和 `queue:read`；投递额外要求 `queue:retry`。点击“前往登录”后，经后台登录返回队列测试页。

- 队列：critical／default／low，消费权重 6／3／1，Worker 共用并发池。
- 模式：success 成功；fail-once 首次失败，后台人工重试成功；always-fail 每次失败。fail-once 标记在 Redis 保留 1 小时，该窗口内保持首次失败／后续成功语义。
- POST `/api/rest/demo/queue-test` 接收 `{"queue":"default","mode":"success"}`，`queue=all` 顺次投递三队列；成功项返回任务 ID。部分投递成功返回 202，逐项显示结果；全部失败返回 503。
- 演示任务使用独立类型 `demo:queue-test`；页面只展示最近 20 条该类型执行记录，刷新后更新。已有后台可继续查看详情和人工重试。
- `pnpm build:frontend` 生成公开 JS、共享 CSS 和 manifest；`pnpm build` 将模板与资源一并嵌入 Web。模板／主题脚本修改由开发监管器触发 Go 重建；公开 `public.ts`／CSS 修改后重新启动 `pnpm dev`，更新该次开发运行的私有构建资源；正式资源通过 `pnpm build:frontend` 更新。后台 SPA 继续走 Vite HMR。

验收记录见 `/home/dream/wwwroot/go-starter/docs/public-ssr-verification.md`。

### 计划监控平台规则

计划在业务代码中注册，Web 与 Worker 共同传入同一组定义。计划页继承 `queue:read`；重试权限独立于计划读取权限。Go 使用 Redis 租约选主（3 秒），所有调度器每 250 毫秒检查调度并上报心跳（有效期 10 秒），正常退出清理自身心跳。心跳展示安全实例 ID，租约 token 和内部派发错误保留在服务端。

Cron 支持 5／6 字段与 `@every`，时区显式配置；`@every` 按 UTC epoch 对齐相位，Leader 切换保持执行槽一致。停用计划继续保留定义和历史派发结果。派发状态 `idle`／`dispatched`／`dispatch_failed` 表示入队观测，业务执行状态在执行记录页查看。调度器心跳与 Worker 消费进程 presence 分别接入。

Node.js 参考调度参数为检查 30 秒、Leader 租约 45 秒、心跳有效期 120 秒；Go 沿用检查 250 毫秒、Leader 租约 3 秒、心跳有效期 10 秒。参考版按宿主机时间和分钟槽匹配 Cron，Go 使用 Redis TIME 与秒级执行槽。各项参数与停用时间展示差异单列于 `/home/dream/wwwroot/go-starter/docs/queue-management-verification.md`。

## 多数据库验收入口

`rtk pnpm verify` 执行 MySQL／SQLite 宿主机完整验收；`rtk pnpm verify:postgresql` 使用隔离 PostgreSQL／Redis 容器与本地构建的运行镜像；`rtk pnpm verify:postgresql:browser` 追加同一前端的真实浏览器测试；`rtk pnpm verify:postgresql:docker` 执行完整多阶段构建。通用 Docker 入口支持 `--database mysql|postgres`。

真实测试使用 `MYSQL_TEST_DSN`／`MYSQL_AUTH_TEST_DSN`、`POSTGRES_TEST_DSN`／`POSTGRES_AUTH_TEST_DSN` 与 `REDIS_TEST_URL`。验收器按数据库选择集成用例，并核对实际执行结果；默认 `pnpm test` 服务纯单测与 SQLite 回归，外部数据库测试等待独立 fixture。
