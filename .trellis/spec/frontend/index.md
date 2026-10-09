# 示例 React SPA

用于 frontend 路由、菜单、请求和后台接入。先读 `frontend/src/main.tsx`、`frontend/src/app.tsx`（路由/菜单）、`frontend/src/adapter.ts`、`frontend/src/request.ts`；这些路径相对应用目录 projects/multi-database-demo。

- Router 挂载 `/admin/`，复用 @shanjing/shadcnui-dashboard；业务 adapter/菜单留在应用。
- request.ts 统一同源 fetch、credentials: include、错误与取消，GraphQL 为 `/api/graphql/admin`。操作在 adapter，输入/空值与 SDL 一致。
- 沿用 ApiError/响应校验，处理会话未就绪、无权限、失败、取消；服务端同时鉴权。
- 路由/Vite base 变化同时核对 Go SPA 深链、公开资源和 webui；先 Vite 后 Go，不手改 dist。
- 偏好沿用 go-mysql-demo 等现有 key，目录重命名不重置用户数据。

根目录验证：`rtk pnpm --filter multi-database-demo-dashboard typecheck`、`rtk pnpm build:frontend`；交互变化补 `rtk pnpm test:browser`（浏览器/独立运行环境）。

公共组件见 [公共前端](shared-dashboard.md)，接口见 [GraphQL](../backend/graphql-guidelines.md)，完整门禁见后端 quality-guidelines。
