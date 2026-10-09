# 后端质量与验收

命令在工作区根执行。先 `rtk pnpm setup`，版本由 toolchain.json/锁文件固定。当前 setup/监管要求 Linux amd64/WSL，监管还需要 Python pidfd；macOS 的 Trellis 检查不等于业务监管验证。

- Go 测试同目录 `*_test.go`，可用 `<包名>_test`；fixture 用既有包内布局，不建集中式 Go tests。
- 迭代运行受影响用例；全量 `rtk pnpm test:go`、覆盖率 `rtk pnpm test:go:coverage`。直接调 Go 时沿用 .tools、GOWORK、前端快照和环境约定。
- 收尾 `rtk pnpm check`（格式/vet/类型）、`rtk pnpm test`（脚本/Go/Dashboard）、`rtk pnpm build`（SPA/Web/Worker）。改测试脚本还必须运行 `rtk pnpm test:go:coverage`。
- 真实 DB、Redis、浏览器、Docker、race 属于额外依赖；记录未覆盖项，不以单测替代真实验收。每批 fixture/数据库/端口隔离。
- 新行为/修复给 RED/GREEN 或 MANUAL 证据；环境不足记录命令与阻塞，不虚报通过。
- docs/spec 单独变化只检查链接、格式、Trellis 入口/Python 语法，不引发无关构建。

事实入口为 `scripts/project.py`、`docs/go-test-layout.md`。不通过修改格式排除或工具版本来掩盖验证问题。

开发进程清理先用完整快照核验归属；之后核对 PID 与启动时钟及 `/proc/<pid>/stat` 存活状态。退出时 cwd/exe 元数据可能先于监听套接字消失，不能把完整快照读不到视为端口已释放。保留 pidfd 信号、其他项目进程保护和端口复查，回归覆盖元数据提前消失但套接字延迟释放的窗口。
