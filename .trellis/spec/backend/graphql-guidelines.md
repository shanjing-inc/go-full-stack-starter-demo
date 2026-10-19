# GraphQL 接口

新增接口、输入/DTO 或认证边界变化时使用。装配：应用 `backend/cmd/web/main.go`、`backend/internal/web/server.go`；协议适配：共享包 `transport/graphql`。

| 契约     | 入口                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| Member   | `/api/graphql/member`、应用 `share/schema/member.graphqls`、`backend/gqlgen-member.yml`、`backend/internal/graph/member` |
| Admin    | `/api/graphql/admin`、应用 `share/schema/admin.graphqls`、`backend/gqlgen-admin.yml`、`backend/internal/graph/admin`     |
| 共用定义 | 应用 `share/schema/common.graphqls`、`backend/internal/graph/model`、`backend/internal/graph/scalar`                     |
| 前端请求 | 应用 `frontend/src/lib/request.ts`、`frontend/src/app/dashboard-adapter.ts`                                              |

两端 Schema 隔离；Admin 按实际根字段执行认证门禁，resolver 保留资源动作权限。沿用 camelCase、已有 `get*`/`list*` 和 `create*`/`update*`/`delete*` 命名、where/orderBy/分页契约。DTO 将整数 ID 映射为字符串，时间走 DateTime，保持 nullable/可选输入语义。

## Dashboard 首页概览

- Admin `getDashboardOverview: DashboardOverview!` 返回 `shops: Int!`、`backend: String!`、`mode: String!`；权限沿用 `shop:list`，Member Schema 保持隔离。
- 店铺数量由 `service.Shops.Count(ctx)` 执行全量统计，数据库实现直接执行 COUNT，内存实现遵循读锁与取消边界。
- 首页 adapter 使用 `GET_DASHBOARD_OVERVIEW` 及生成的结果/变量类型，沿用统一请求的认证、权限、错误和取消机制。旧概览 REST 已删除。

## 新接口步骤

1. 定义端点、权限、输入、空值/错误契约，读相邻 Schema 和 resolver 测试。
2. 改 SDL、必要 DTO 与业务 service；通用能力放共享模块。
3. 根目录 `rtk pnpm generate`，核对两份 gqlgen、Gen 与前端操作类型 diff。
4. 实现 resolver 的校验/鉴权/业务调用，不在生成文件或前端重复查询。
5. frontend 静态操作、生成的结果/变量类型与公共 DashboardAdapter 同时核对；`rtk pnpm codegen:check` 校验 Admin SDL 与操作产物。
6. 同目录 `*_test.go` 覆盖允许/拒绝权限、非法输入、空结果和协议回归。
7. 运行受影响用例/类型检查，代码与 spec 同次交付。

不照搬 Node Pothos loader API；本仓没有统一 Node DataLoader 接口。新增批处理先定位实际查询与请求作用域，给出同请求复用、跨请求隔离及查询次数证据，再沉淀规范。

## 后台认证与混合权限端点

- Admin Schema 开放 `getInstallStatus: InstallStatus!` 与三个 mutation：`initializeAdmin(input: InitializeAdminInput!): UserItem!`、`signInWithEmail(input: SignInWithEmailInput!): UserItem!`、`signOut: Boolean!`。Member Schema 保持独立。
- 应用为 AdminPath 与 MemberPath 配置 `auth.Config.OptionalAuthPaths`，并在 gqlgen `AroundFields` 中按实际 Query/Mutation 字段名称执行公开白名单。其余根字段统一调用 `RequireAdmin(ctx)`，业务服务继续验证资源动作权限；别名、fragment、混合操作和 batch 元素分别通过同一门禁。
- Guard 在请求开始时解析身份，登录成功后的身份供后续 HTTP 请求使用。同请求的登录后私有字段仍要求请求开始时的有效后台身份。
- resolver 复用 `InstallStatus`、`InitializeRequest`、`LoginRequest`、`LogoutRequest`；初始化保持引导令牌与原子创建，登录/初始化每个逻辑操作均执行共享 IP/账号限流。认证写操作要求 POST 和合法 Origin，签名 HttpOnly/SameSite Cookie 由服务端写入，结果只暴露用户字段。
- 认证业务错误通过 GraphQL `errors[].extensions.code` 返回；来源门禁可直接返回 HTTP 403。基础设施错误返回脱敏 SERVICE_UNAVAILABLE，限流保留 Retry-After。旧 `/api/auth/*`、后台概览／session REST 及公共 `DashboardPath` 已删除，旧入口统一返回 404。
- 回归位于 `backend/internal/web/session_test.go` 与公共 auth 同目录测试；覆盖初始化、登录、退出、权限、来源、过期/封禁、别名/batch 限流和 Cookie。公共 kit API 发布与应用固定版本升级属于独立发布验收，工作区通过单独记录。

## Member 小程序认证

- Member SDL 新增 `MemberSignInInput`、`MemberSignInPayload` 与 `signInWithEmail`／`signOut` mutation；登录只返回新建 Bearer token。Admin 登录响应保持用户安全投影。
- Member 写入口调用 `LoginBearerRequest`／`LogoutBearerRequest`，要求 POST 且无 Cookie；原生客户端允许缺少 Origin，提供来源时执行白名单校验，跨站请求拒绝。使用和 Admin 相同的 IP／账号限流桶；alias 与 batch 逐操作计数。
- Member 查询及后续业务 mutation 默认调用 `RequireUser`，仅登录／退出按字段公开。登录后身份供后续 HTTP 请求使用；无效会话通过 GraphQL UNAUTHORIZED 表达，客户端同时处理 HTTP 401 与 GraphQL 业务码。
- 回归并入既有 `session_test.go`：旧入口 404、无 Origin 登录、Cookie／跨站拒绝、查询门禁、共享限流、批量计数、幂等退出及两端会话独立撤销。
