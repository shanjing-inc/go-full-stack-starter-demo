# Go Starter 规范入口

适用于 Go/Echo/gqlgen/GORM/Gen/Atlas、React/Vite 工作区；按修改范围读取。路径相对含 `go.work` 的工作区根。

| 范围           | 规范入口                                                     | 源码                                    |
| -------------- | ------------------------------------------------------------ | --------------------------------------- |
| Go 公共能力    | [公共后端](go-server-kit/backend/index.md)                   | `packages/go-server-kit`                |
| 应用与协议     | [demo 后端](multi-database-demo/backend/index.md)            | `projects/multi-database-demo`          |
| 公共 Dashboard | [公共前端](shadcnui-dashboard/frontend/index.md)             | `packages/shadcnui-dashboard`           |
| 示例 SPA       | [demo 前端](multi-database-demo-dashboard/frontend/index.md) | `projects/multi-database-demo/frontend` |
| 跨层与复用     | [指南](guides/index.md)、[复用清单](guides/reuse-guide.md)   | `scripts`、`tools`、`poc`               |

当前只有一个正式应用 demo。`poc/database`、`poc/web`、`poc/realtime`、`poc/worker`、`poc/delivery` 是历史隔离验证工程，由主仓任务管理，按各自 README 和 `scripts/*-poc.py` 入口验证，不当作独立发布应用。

开发前确认最近 `.trellis` 与任务作用域，读相关源码、同目录测试和本包规范。PRD 用中文写目标、范围、可验证 AC、环境依赖、交付位置。新规范必须有代码/测试证据，不照搬 Node 的业务技术栈。

收尾检查 spec 与代码一致；规范/框架变更检查链接、格式、Python 语法及 Trellis 入口；业务变化运行受影响检查。区分通过、环境阻塞和未执行，代码与规范同次交付。
