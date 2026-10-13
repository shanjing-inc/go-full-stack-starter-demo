# 后端质量与验收

命令在应用根执行。先 pnpm install --frozen-lockfile、pnpm run setup；toolchain.json 与 lockfile 固定工具/依赖，Go 使用 GOWORK=off。Python 基线为 3.12+。源码锁文件包含 Linux amd64/macOS amd64/arm64 下载矩阵，执行前核验项目 Go 精确版本与平台。当前锁定 devtools 0.1.0 属于 Linux 基线，新版 macOS 适配需正式发布并升级应用精确版本及完整性。macOS 安装/启动/热更新/退出需原生实机验收，容器保留独立验收范围。

- Go 测试同目录 \*\_test.go，可用外部测试包，fixture 隔离。
- 收尾 pnpm check（格式/vet/前端类型）、pnpm test（Vite 配置测试与应用 Go 单测）、pnpm test:go:coverage（应用 backend/cmd/internal 覆盖率）、pnpm build（SPA/Web/Worker）。
- 公共 Go kit、Dashboard 和 devtools 自身测试在主仓或包发布验收，不把公共源码复制到应用。
- 真实 MySQL/PostgreSQL/Redis、浏览器、Docker/race 需要独立环境，明确未覆盖项；不使用空测试替代验收。
- 生成源修改后 pnpm generate，核对 gqlgen/Gen/schema 生成 diff，不手改生成物。
- Linux devtools 保留进程归属、pidfd 信号、启动时钟、运行租约、其他项目保护与退出端口复查。新版 macOS 工具通过 ps/lsof/sysctl 监管当前 Popen 进程组，端口冲突提示用户手动释放，进程引用检查失败保留产物与缓存。cwd/exe 元数据先消失不能视作端口释放。
- Go kit 升级时，对照 go.mod/go.sum 与 release-dependencies.json 的固定版本及真实校验值，使用 `GOWORK=off` 运行检查、测试、覆盖率与构建。
- 修改共享工具时在主仓更新测试与固定发布版本，再升级本应用精确版本和完整性。

命令事实入口是 package.json 与固定版本 @shanjing/go-starter-devtools，不依赖主仓 scripts/tools。凭据与日志不纳入发布。
