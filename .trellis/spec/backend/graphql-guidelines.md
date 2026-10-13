# GraphQL 接口

新增接口、输入/DTO 或认证边界变化时使用。装配：应用 `backend/cmd/web/main.go`、`backend/internal/web/server.go`；协议适配：共享包 `transport/graphql`。

| 契约     | 入口                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| Member   | `/api/graphql/member`、应用 `share/schema/member.graphqls`、`backend/gqlgen-member.yml`、`backend/internal/graph/member` |
| Admin    | `/api/graphql/admin`、应用 `share/schema/admin.graphqls`、`backend/gqlgen-admin.yml`、`backend/internal/graph/admin`     |
| 共用定义 | 应用 `share/schema/common.graphqls`、`backend/internal/graph/model`、`backend/internal/graph/scalar`                     |
| 前端请求 | 应用 `frontend/src/lib/request.ts`、`frontend/src/app/dashboard-adapter.ts`                                              |

两端 Schema 隔离；Admin 路由认证与 resolver 资源动作权限均核对，不只靠前端隐藏按钮。沿用 camelCase、已有 `get*`/`list*` 和 `create*`/`update*`/`delete*` 命名、where/orderBy/分页契约。DTO 将整数 ID 映射为字符串，时间走 DateTime，保持 nullable/可选输入语义。

## 新接口步骤

1. 定义端点、权限、输入、空值/错误契约，读相邻 Schema 和 resolver 测试。
2. 改 SDL、必要 DTO 与业务 service；通用能力放共享模块。
3. 根目录 `rtk pnpm generate`，核对两份 gqlgen、Gen 与前端操作类型 diff。
4. 实现 resolver 的校验/鉴权/业务调用，不在生成文件或前端重复查询。
5. frontend 静态操作、生成的结果/变量类型与公共 DashboardAdapter 同时核对；`rtk pnpm codegen:check` 校验 Admin SDL 与操作产物。
6. 同目录 `*_test.go` 覆盖允许/拒绝权限、非法输入、空结果和协议回归。
7. 运行受影响用例/类型检查，代码与 spec 同次交付。

不照搬 Node Pothos loader API；本仓没有统一 Node DataLoader 接口。新增批处理先定位实际查询与请求作用域，给出同请求复用、跨请求隔离及查询次数证据，再沉淀规范。
