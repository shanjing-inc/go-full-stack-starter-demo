# Demo 规范入口

本 Trellis 根为 projects/multi-database-demo；本目录管理应用任务，共享包/脚本/发布变更用工作区根 Trellis。同一任务不建两份。

- [Go 后端](backend/index.md)
- [React 前端](frontend/index.md)
- [微信小程序](miniprogram/index.md)
- [通用任务/跨层指南](guides/index.md)
- [复用与发布清单](guides/reuse-guide.md)

源码路径相对本应用根；独立发布直接使用同一目录结构、应用命令与固定扩展依赖。

应用根使用 `pnpm dev` 启动 Vite HMR、Go Web 与 Go Worker，使用 `pnpm dev:weapp` 启动小程序 watch。package.json 的 `dev` 直接运行本地 `scripts/dev.py`，frontend 内部 `dev` 运行 Vite。

开发前读源码/同目录测试；代码/命令/接口变化同步 spec；按 backend/quality-guidelines 运行真实命令，明确环境与未覆盖项。
