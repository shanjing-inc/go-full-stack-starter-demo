# 后端质量与验收

命令在应用根执行。先 pnpm install --frozen-lockfile、pnpm setup；toolchain.json 与 lockfile 固定工具/依赖，Go 使用 GOWORK=off。基线 Linux amd64；监管要求原生 Linux Python pidfd。Mac 原生另行验收，容器结果不当作 Mac 通过。

- Go 测试同目录 \*\_test.go，可用外部测试包，fixture 隔离。
- 收尾 pnpm check（格式/vet/前端类型）、pnpm test（应用 Go 单测）、pnpm test:go:coverage（应用 cmd/internal/webui 覆盖率）、pnpm build（SPA/Web/Worker）。
- 公共 Go kit、Dashboard 和 devtools 自身测试在主仓或包发布验收，不把公共源码复制到应用。
- 真实 MySQL/PostgreSQL/Redis、浏览器、Docker/race 需要独立环境，明确未覆盖项；不使用空测试替代验收。
- 生成源修改后 pnpm generate，核对 gqlgen/Gen/schema 生成 diff，不手改生成物。
- devtools 保留进程归属、pidfd 信号、启动时钟、运行租约、其他项目保护与退出端口复查。cwd/exe 元数据先消失不能视作端口释放。
- 修改共享工具时在主仓更新测试与固定发布版本，再升级本应用精确版本和完整性。

命令事实入口是 package.json 与固定版本 @shanjing/go-starter-devtools，不依赖主仓 scripts/tools。凭据与日志不纳入发布。
