# 公共 React Dashboard

Dashboard 来自固定版本 @shanjing/shadcnui-dashboard；应用先读 frontend/src/app/dashboard-adapter.ts、frontend/src/app/app.tsx。公共源码与页面测试在主仓公共包维护，不复制到独立应用。本包使用 React/React Router、shadcn/ui、Tailwind v4。

- 页面在 src/pages，控件在 src/components，基础 UI 在 src/components/ui；先复用已有控件，业务接入留在应用 adapter。
- DashboardAdapter 为 UI/Go 边界；输入、响应、权限、可空值变更同时更新应用 frontend/src/app/dashboard-adapter.ts，不在 UI 写死 DB 查询或密钥。
- 会话完成前保留加载/错误状态；沿用 useEffect/AbortController，卸载/登出取消请求，避免旧响应覆盖新会话。
- 路由用 react-router 与应用菜单；偏好沿用现有 key，不未经迁移改 namespace。筛选、分页由服务端执行。
- 公共包单元与组件测试集中在 tests/unit，按 src 相对目录组织；setup 位于 tests/setup.ts。TypeScript 与 ESLint 覆盖 src/tests，发布构建仅包含 src。

根目录验证：`rtk pnpm --filter @shanjing/shadcnui-dashboard typecheck`、`rtk pnpm test:ui`、`rtk pnpm build:dashboard`。跨应用契约变化补应用类型/浏览器检查。遵循根 Prettier，spec 随 API 更新。

## 日历分发与日期边界验收

空范围通过日历选择日期后，上界为结束日 `23:59:59.999`；已有手动时间保留原精度。浏览器回归同时验证毫秒请求参数、日末记录包含、次日零点排除、URL 刷新恢复，以及表单提交有效性。

新增公共包能力先构建并 pack，在应用单独安装该 tarball 后执行构建与浏览器回归，避免工作区源码 alias 掩盖分发缺口。正式升级使用已获发布授权且已发布的 registry 精确版本，同步 frontend/package.json、主仓和应用锁文件、release-dependencies.json 的真实 dist 元数据，再执行 registry 冻结安装与应用回归；本地 tarball 验证单独记录。
