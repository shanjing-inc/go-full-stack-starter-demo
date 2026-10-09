# Demo 规范入口

本 Trellis 根为 projects/multi-database-demo；本目录管理应用任务，共享包/脚本/发布变更用工作区根 Trellis。同一任务不建两份。

- [Go 后端](backend/index.md)
- [React 前端](frontend/index.md)
- [通用任务/跨层指南](guides/index.md)
- [复用与发布清单](guides/reuse-guide.md)

源码路径相对本应用根；独立发布直接使用同一目录结构、应用命令与固定扩展依赖。

开发前读源码/同目录测试；代码/命令/接口变化同步 spec；按 backend/quality-guidelines 运行真实命令，明确环境与未覆盖项。
