# 示例 React SPA

用于 frontend 路由、菜单、请求和后台接入。先读 `frontend/src/main.tsx`、`frontend/src/app.tsx`（路由/菜单）、`frontend/src/adapter.ts`、`frontend/src/request.ts`；这些路径相对应用目录 projects/multi-database-demo。

- Router 挂载 `/admin/`，复用 @shanjing/shadcnui-dashboard；业务 adapter/菜单留在应用。
- request.ts 统一同源 fetch、credentials: include、错误与取消，GraphQL 为 `/api/graphql/admin`。操作集中在 graphql/admin，adapter 显式使用生成的结果/变量类型，输入/空值与 SDL 一致。
- 沿用 ApiError/响应校验，处理会话未就绪、无权限、失败、取消；服务端同时鉴权。
- 路由/Vite base 变化同时核对 Go SPA 深链、公开资源和 `internal/web` 内嵌资源；先 Vite 后 Go，不手改 dist。
- 偏好沿用 go-mysql-demo 等现有 key，目录重命名不重置用户数据。

Vite、Codegen 和请求回归由 `frontend/package.json` 的 `test` 执行；主仓与独立应用的 `pnpm test` 在前端构建后调用该入口，配置测试失败立即终止后续检查。

根目录验证：`rtk pnpm --filter multi-database-demo-dashboard typecheck`、`rtk pnpm build:frontend`；交互变化补 `rtk pnpm test:browser`（浏览器/独立运行环境）。

公共组件见 [公共前端](shared-dashboard.md)，接口见 [GraphQL](../backend/graphql-guidelines.md)，完整门禁见后端 quality-guidelines。

## GraphQL 操作类型生成

- Admin 的操作与共享片段集中在应用 `frontend/src/graphql/admin/operations.ts`；`generated.ts` 由 Codegen 生成并随源码提交。
- `frontend/codegen.mjs` 直接读取 `schema/common.graphqls`、`schema/admin.graphqls`、`schema/queue.graphqls`，与 `gqlgen-admin.yml` 对齐。Member 增加调用时使用独立文档、配置和产物，保持端点隔离。
- 使用 `typescript-operations` v6 生成操作结果、变量及所需输入类型；调用 `graphql<TResult, TVariables>` 时显式关联类型。运行时沿用 fetch、Cookie、取消和 ApiError 边界。
- 含片段的操作先声明独立静态模板，再在导出常量中拼接片段；运行时文档与生成类型的完整性由测试同时校验。
- DateTime 输入/输出为 `string`，JSON 为 `unknown`；未知 scalar 触发失败。响应字段保留 SDL 空值语义，输入保留可选语义；公共 DashboardAdapter 类型独立维护。
- `rtk pnpm codegen` 更新产物；`rtk pnpm codegen:check` 在内存重新生成并逐字比较，检查过程只读，支持未提交变更和无 Git 的独立应用。
- 前端 `build`、`typecheck` 先执行同步检查；主仓 `rtk pnpm generate` 在 Go 与 SQL 生成后更新前端类型。独立应用可直接使用自己的 `rtk pnpm codegen`；devtools 全生成链路的正式分发跟随工具新版本发布。
- 前端 `test` 同时验证 Vite、生成/只读检查、运行时操作完整性及请求行为；类型契约用 `src/graphql/admin/type-contract.test.ts` 的编译错误断言校验；用户对象与 ID 字段的空值契约分别断言，ID 通过 `NonNullable` 用户直接访问，避免可选链引入的 `undefined` 掩盖字段类型漂移。
- Docker 前端构建阶段复制应用 SDL；生成与检查只依赖源码和 npm 工具链。
