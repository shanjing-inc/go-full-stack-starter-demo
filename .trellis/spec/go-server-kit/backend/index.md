# Go 公共基础包

用于 `packages/go-server-kit/{infra,modules,transport}`。读本包及 modules/auth、modules/queue 的 README、相邻源码、同目录测试、应用调用方。

公共 API 不带 demo 业务命名。认证、队列、错误契约变化同时验证 resolver、Web/Worker、前端 adapter。测试 Redis 可复用 `internal/testredis`，真实库权限/运行单独验收。

- [目录与生成边界](../../multi-database-demo/backend/directory-structure.md)
- [数据库](../../multi-database-demo/backend/database-guidelines.md)
- [错误与日志](../../multi-database-demo/backend/error-handling.md)
- [测试与门禁](../../multi-database-demo/backend/quality-guidelines.md)

收尾使用工作区统一入口发现公共包和 demo，不搬迁测试布局。
