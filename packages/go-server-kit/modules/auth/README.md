# 公共邮箱认证模块

模型与 Service 由公共包维护，应用负责组合模型、最终迁移与 HTTP 装配。Service 借用应用 GORM 连接；RedisLimiter 借用共享 Redis client，资源释放由应用负责。

## 装配

1. 应用 Models 合并 `auth.Models()`；导出并审核最终 migration，创建认证四表及固定 `auth_bootstrap(id=1, revision=0)`。
2. 使用至少 32 字节随机 `Secret` 创建 Service。初始化期间设置独立 `BootstrapToken`，完成后清空并重启 Web。
3. 配置精确 `Origins`、生产 `Secure=true`、要求 `dashboard:access:admin` 的 `AdminPaths`。`Permissions` 支持应用自定义角色策略，`PathPermissions` 为具体 API／路由模板配置资源动作。Dashboard 使用 `DashboardPath` 输出公共策略权限；`DashboardPermissions` 回调用于额外应用菜单标识。
4. 调用 `Register(e, RedisLimiter{Client: redisClient, Prefix: namespace})`。身份通过 `UserFrom(ctx)` 获取，后续业务 Service 使用该 context。

默认保护 `/api/` 下的业务请求；`/api/auth/` 自身路由与标准健康探针保持公开。静态 SPA 由应用保护路由控制页面进入，服务端执行 API 身份和权限校验。AdminPaths 默认允许 owner／admin，使用自定义策略时按 `dashboard:access:admin` 判定。资源动作通过 `Require(ctx, resource, action)` 校验，REST／GraphQL／连接入口共用该方法。

## 核心 API

| 方法与路径                     | 输入／结果                                                    |
| ------------------------------ | ------------------------------------------------------------- |
| GET `/api/auth/install-status` | `installed` 与 `enabled`                                      |
| POST `/api/auth/initialize`    | name／email／password／bootstrapToken；201 user               |
| POST `/api/auth/sign-in/email` | email／password；返回 user 与 Bearer token，并设置签名 Cookie |
| GET `/api/auth/get-session`    | 有效会话返回 user／session 元信息；失效会话返回 null          |
| POST `/api/auth/sign-out`      | 删除当前 Cookie／Bearer 会话并清理 Cookie                     |
| GET 配置的 DashboardPath       | 真实 user／应用 permissions／authenticated 模式               |

Cookie 默认名为 `better-auth.session_token`；Secure 模式默认 `__Secure-better-auth.session_token`，Path=/、HttpOnly、SameSite=Lax。Cookie 保存 URL 编码的 token.HMAC-SHA256 签名。Bearer 支持原始会话 token 与同格式签名 token；查询会话结果隐藏 token。

Cookie 写请求与 Cookie WebSocket 升级要求 Origin；带 Origin 的请求按精确白名单检查。跨源预检通过显式 CORS 中间件处理。共享 Redis 对 IP 每分钟 20 次、账号每分钟 5 次进行原子限流。IP 桶先执行；邮箱按登录使用的数据库匹配规则查询账号，已注册邮箱使用账号 ID 共享桶，未知邮箱使用规范化邮箱桶。限流键通过 HMAC 隐藏原始标识；IP 来自 RemoteAddr。反向代理可信跳数和客户端 IP 解析在生产部署中明确配置。

角色沿用旧认证的逗号分隔格式，`HasRole` 逐项、大小写敏感地匹配完整名称。`owner,user`、`user,admin` 及中间位置管理员均可授权；`superadmin`、`admin-extra` 和大写角色按独立角色处理。Installed、事务锁内初始化检查、Guard 与应用 Dashboard 权限使用一致规则，已有组合管理员会关闭初始化入口。

新密码设置（含首位管理员初始化）采用 **8–128 个 UTF-8 字节**；登录采用独立的 **512 字节**上限，覆盖旧注册允许 128 个 UTF-16 码元的多字节密码。HTTP 保留 4096 字节请求上限、共享 Redis 限流与四个密码派生并发槽。固定 Node fixture 覆盖 50／128 个汉字和 64 个 emoji；SQLite、真实 MySQL 和 HTTP 登录回归验证旧散列兼容。

scrypt 保持参考固定参数 N=16384／r=16／p=1／dkLen=64、NFKC 和 hex-salt:hex-key 格式。生产部署保留旧密钥和数据库时区时可沿用已登录 session；生产切换参见 `/home/dream/wwwroot/go-starter/docs/migration-compatibility-matrix.md`。

## 测试

认证 MySQL 集成测试通过 `MYSQL_AUTH_TEST_DSN` 指定独立测试库，业务集成测试使用 `MYSQL_TEST_DSN`。`pnpm verify` 自动创建并传入两个隔离库，覆盖跨连接初始化、会话撤销和应用完整回归。

`/home/dream/wwwroot/go-starter/packages/go-server-kit/modules/auth/compatibility_test.go` 覆盖旧多字节密码、512／513 字节登录门禁、逗号组合角色、大小写与子串边界，以及安装状态／初始化／管理员 API 的一致性。

## 角色／资源／动作权限（R2 第一批）

`DefaultRolePermissions()` 对齐参考 owner／admin／member／user：owner 包含 `system:owner`，admin 持有后台、业务列表、店铺创建、用户、会话与队列管理权限，member 持有 `dashboard:access:member`，user 为普通身份。组合角色按完整名称、大小写敏感地取并集，权限列表排序并去重。

- `Config.Permissions=nil` 使用默认策略；空 map 配置 deny-all。配置深复制后保持稳定。
- `Allows(user, resource, action)` 和 `Require(ctx, resource, action)` 供业务授权；身份来自验证后的 `UserFrom(ctx)`。
- `PathPermissions` 先匹配实际 URL，再匹配 Echo 路由模板，例如 `/api/rest/users/:id`。连接入口可以配置 WebSocket／SSE 路径，在握手阶段拒绝越权。
- 默认连接入口继续执行已有登录与 Origin 门禁；应用按业务契约添加资源动作。Admin GraphQL 外层执行后台访问门禁，用户字段再检查 `user:get`／`user:list`。
- Dashboard 会话输出公共权限及应用额外标识。新增资源入口需同步接入服务端校验，权限声明与已上线接口分别登记。

## 用户只读查询

`CurrentUser(ctx)` 从数据库重读当前身份；`GetUser(ctx, filters)` 要求 `user:get` 及有效条件；`ListUsers(ctx, query)` 要求 `user:list`。公共 DTO 位于 `/home/dream/wwwroot/go-starter/packages/go-server-kit/modules/auth/users.go`，协议转换由应用负责。

筛选覆盖 ID 整数条件、邮箱／角色字符串条件及封禁／验证布尔值。字符串支持等值、比较、LIKE／ILIKE、数组和 NULL 操作；数组最多 100 项，单字符串最多 512 字节。空 IN 返回空结果，空 NOT IN 保持查询范围；NULL 与 false 各自保持 SQL 语义。角色筛选采用原始字段精确匹配，权限判定采用逗号角色并集。

limit 为 0–101，offset≥0；排序字段白名单为 id／name／email／role／createdAt／updatedAt。默认创建时间倒序，补 ID 倒序保持稳定；未知或重复排序字段返回 `BAD_USER_INPUT`。SQL 值参数化，列名与操作符来自固定白名单。

## 查询审计与存储职责

`AuditEvent` 包含 actor ID、resource、action、target、result、UTC time 和 request ID。当前用户／单用户／列表查询记录 success／denied／failed；Guard 的权限拒绝也记录审计。目标采用用户 ID 或固定集合标识，凭据、查询邮箱和原始错误保持在请求边界内。

`Config.Audit` 可注入集中审计 sink；缺省使用 `slog.InfoContext` 结构化输出。sink 应完成线程安全、快速入队及故障告警；部署方配置日志采集、访问控制、存储与保留周期，本批保持已有数据库结构。用户创建／更新和全量撤销会话同步记录管理审计；所有权转移、删除及完整密码管理按后续批次实施。

### 共享后台权限

`Service.DashboardPermissions(user)` 返回排序、去重的角色权限与 `Config.DashboardPermissions` 应用别名并集。兼容 `DashboardPath` 与应用 GraphQL 身份查询复用该方法；GraphQL 读取 Guard 注入的 `auth.UserFrom(ctx)`，后台访问门禁沿用 `AdminPaths`。自身身份与权限查询独立于用户列表的 `user:list` 权限。

## 长连接会话复核

Guard 在身份 context 中附加会话复核函数，业务长连接调用 `auth.ValidateConnection(ctx)`。本应用的 Bus WebSocket 在发送数据、处理输入及设备刷新周期执行复核；退出撤销、过期、封禁、用户删除、角色或有效权限变化后结束连接，设备 presence 随连接清理。数据库复核失败采用关闭连接策略。公开样例 context 保持公开行为。

复核直接读取共享数据库，其他实例写入的撤销及权限变更同样生效。默认空闲检查周期为 500 毫秒，数据库复核超时为 3 秒；数据库读延迟计入生效窗口。已发送帧和已发布回执保持完成状态，复核与发送之间保留并发操作的时间窗口。此机制增加连接期间的数据库读开销，生产容量验收覆盖连接数及消息速率。

WebSocket 复核沿用数据库有效期，HTTP `Resolve` 保留每日触发的七天滑动续期。时间点校验使用 Go 的 `time.Time`，覆盖 SQLite 带时区的旧 DATETIME 文本。SSE 查询保持既有 HTTP 请求截止／取消生命周期。

`shop:list` 管理列表与详情读取，`shop:create` 管理创建。默认 owner／admin 显式持有创建权限，自定义只读角色按所需动作授权；前端创建入口与 GraphQL mutation 同时校验创建权限。

## 用户管理写操作（R2 第二批）

公共 DTO 与服务位于 `/home/dream/wwwroot/go-starter/packages/go-server-kit/modules/auth/user_mutations.go`，应用在完成身份校验后调用：

- `CreateUser(ctx, CreateUserInput)`：要求 `user:create`；分配非 user 角色额外要求 `user:set-role`。名称／邮箱校验后写入 User 和 credential Account，密码按既有散列规则生成，账号创建失败统一回滚。
- `UpdateUsers(ctx, UserFilters, UpdateUserInput)`：名称要求 `user:update`，角色要求 `user:set-role`，封禁及原因／到期要求 `user:ban`。至少一个有效筛选，最多 100 个目标；批处理任一目标拒绝则全部回滚。`Optional[T]` 的 Set 表示字段是否提交，Value=nil 表示显式清空。
- `RevokeUserSessions(ctx, userID)`：要求 `session:revoke`，目标 ID 为正整数；删除全部会话，重复执行成功，目标缺失返回 `BAD_USER_INPUT`。

管理事务获取 `auth_bootstrap(id=1)` 单例写锁，随后重读操作者权限及目标。角色权限须属于操作者权限集合；owner 管理要求 owner 角色和 `system:owner`，直接分配 owner 及 owner 角色变更留给所有权转移。当前账号保留自身角色与有效登录能力。最后可用 owner 按完整角色和有效封禁状态复核。

名称变更保留会话；实际角色变更、封禁及已封禁账号的到期调整在同一事务删除会话。登录在锁外验证密码，在同一写锁内复核账号封禁及已验证凭据，避免并发封禁期间写入新会话。默认策略为先完成的登录会话受后续管理操作撤销；解封及封禁到期后允许使用正确凭据重新登录。全局锁吞吐与等待时间进入容量专项验收。

管理审计动作是 `user:create`、`user:update`、`user:set-role`、`user:ban`、`session:revoke`。事件包含数字目标 ID 和请求关联标识；密码、散列、token、邮箱和封禁原因保持在业务输入边界内。

## 后台会话列表与单会话撤销

`ListUserSessions(ctx, userID, limit, offset)` 要求 `session:list`，返回有效期内的安全 `SessionInfo` 投影。limit=0 使用默认 20 条，最大 101 条；offset 上限 1000000。按创建时间及 ID 倒序，SQL 投影排除 token。应用通过 `Guard` 装配身份及当前会话标识；纯 Service 调用省略当前会话上下文时，`Current` 默认为 false。

`RevokeUserSession(ctx, userID, sessionID)` 要求 `session:revoke`，在管理事务中重新检查操作者和目标角色授权范围，按用户及会话 ID 联合限定删除。重复撤销成功；同账号的其他会话保持有效。HTTP 与长连接后续验证通过共享存储感知撤销，客户端请求取消后已完成的服务端写入保持生效。

两项操作沿用 owner 保护、封禁检查及结构化审计。MySQL 承担筛选、排序及分页；SQLite 快速测试按解析后的 Go 时间处理目标用户安全投影，以兼容现有时区存储格式。单撤销审计动作使用 `revoke-one`、目标 `用户ID/会话ID`，原全部撤销的 `revoke` 动作保持原契约。
