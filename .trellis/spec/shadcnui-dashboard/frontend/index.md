# 公共 React Dashboard

用于 `packages/shadcnui-dashboard/src`。前置阅读 src/adapter.ts、src/dashboard.tsx、src/index.ts 和受影响页面测试。本包使用 React/React Router、shadcn/ui、Tailwind v4。

- 页面在 src/pages，控件在 src/components，基础 UI 在 src/components/ui；先复用已有控件，业务接入留在应用 adapter。
- DashboardAdapter 为 UI/Go 边界；输入、响应、权限、可空值变更同时更新应用 frontend/src/adapter.ts，不在 UI 写死 DB 查询或密钥。
- 会话完成前保留加载/错误状态；沿用 useEffect/AbortController，卸载/登出取消请求，避免旧响应覆盖新会话。
- 路由用 react-router 与应用菜单；偏好沿用现有 key，不未经迁移改 namespace。筛选、分页由服务端执行。
- 单测延续源码旁 \*.test.ts，不强制 Go 布局到前端，不引入 Node demo 未使用的 hooks。

根目录验证：`rtk pnpm --filter @shanjing/shadcnui-dashboard typecheck`、`rtk pnpm test:ui`、`rtk pnpm build:dashboard`。跨应用契约变化补应用类型/浏览器检查。遵循根 Prettier，spec 随 API 更新。
