# GraphQL 接口

新增接口、输入/DTO 或认证边界变化时使用。装配：应用 `cmd/web/main.go`、`internal/web/server.go`；协议适配：共享包 `transport/graphql`。

| 契约     | 入口                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------- |
| Member   | `/api/graphql/member`、应用 `schema/member.graphqls`、`gqlgen-member.yml`、`internal/graph/member` |
| Admin    | `/api/graphql/admin`、应用 `schema/admin.graphqls`、`gqlgen-admin.yml`、`internal/graph/admin`     |
| 共用定义 | 应用 `schema/common.graphqls`、`internal/graph/model`、`internal/graph/scalar`                     |
| 前端请求 | 应用 `frontend/src/request.ts`、`frontend/src/adapter.ts`                                          |

两端 Schema 隔离；Admin 路由认证与 resolver 资源动作权限均核对，不只靠前端隐藏按钮。沿用 camelCase、已有 `get*`/`list*` 和 `create*`/`update*`/`delete*` 命名、where/orderBy/分页契约。DTO 将整数 ID 映射为字符串，时间走 DateTime，保持 nullable/可选输入语义。

## 新接口步骤

1. 定义端点、权限、输入、空值/错误契约，读相邻 Schema 和 resolver 测试。
2. 改 SDL、必要 DTO 与业务 service；通用能力放共享模块。
3. 根目录 `rtk pnpm generate`，核对两份 gqlgen 和 Gen diff。
4. 实现 resolver 的校验/鉴权/业务调用，不在生成文件或前端重复查询。
5. frontend adapter 与公共 DashboardAdapter 类型同时核对。
6. 同目录 `*_test.go` 覆盖允许/拒绝权限、非法输入、空结果和协议回归。
7. 运行受影响用例/类型检查，代码与 spec 同次交付。

不照搬 Node Pothos loader API；本仓没有统一 Node DataLoader 接口。新增批处理先定位实际查询与请求作用域，给出同请求复用、跨请求隔离及查询次数证据，再沉淀规范。
