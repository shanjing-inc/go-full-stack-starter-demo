# 后端质量与验收

命令在应用根执行。先 pnpm install --frozen-lockfile、pnpm run setup；toolchain.json 与 lockfile 固定工具/依赖，Go 默认使用 GOWORK=off。Python 基线为 3.12+。源码锁文件包含 Linux amd64/macOS amd64/arm64 下载矩阵，执行前核验项目 Go 精确版本与平台。应用本地脚本包含 Linux 与 macOS 适配。macOS 安装/启动/热更新/退出需原生实机验收，容器保留独立验收范围。

- Go 测试同目录 \*\_test.go，可用外部测试包，fixture 隔离。
- 收尾 pnpm check（格式/vet/前端类型）、pnpm test（Vite 配置测试、公共 format-go 工具与业务 Go 单测）、pnpm test:go:coverage（应用 backend/cmd/internal 覆盖率）、pnpm build（SPA/Web/Worker）。
- 公共 Go kit、Dashboard 和共享工具自身测试在主仓或包发布验收，不把公共源码复制到应用。
- 真实 MySQL/PostgreSQL/Redis、浏览器、Docker/race 需要独立环境，明确未覆盖项；不使用空测试替代验收。
- 生成源修改后 pnpm generate，核对 gqlgen/Gen/schema 生成 diff，不手改生成物。
- Linux 开发监管保留进程归属、pidfd 信号、启动时钟、运行租约、其他项目保护与退出端口复查。macOS 工具通过 ps/lsof/sysctl 监管当前 Popen 进程组，端口冲突提示用户手动释放，进程引用检查失败保留产物与缓存。cwd/exe 元数据先消失不能视作端口释放。
- Go kit 升级时，对照 go.mod/go.sum 与 release-dependencies.json 的固定版本及真实校验值，使用 `GOWORK=off` 运行检查、测试、覆盖率与构建。
- 修改应用工具时同步本地脚本、主仓回归和规范，工具源码随固定应用提交交付。

命令事实入口是本应用 package.json、scripts 与 tools。凭据与日志不纳入发布。

## 开发接管与多模块快照

开发运行租约记录所选 Go 模块的规范路径；Linux 自动接管需要模块、监管进程启动身份和开机身份同时通过核验。孤儿 Web／Worker／Vite 还需确认原监管身份已退出。跨应用运行、缺失身份的历史进程和损坏租约由端口冲突提示人工处理。macOS 继续采用已有手动端口释放边界。

工作区联调按 go.work use 清单统一生成代际源码快照和输入指纹，完整保留各正式模块及共享依赖；独立应用保持自身模块快照与默认 GOWORK=off。主仓回归覆盖双 demo 真实构建、额外共享模块改动后的再次构建及跨应用进程保护。

## 显式本地 kit 联调与发布验收

本地 STARTER_KIT_SOURCE 优先于应用根 .starter.local.json 的 kitSource；相对路径以应用根解析，必须是正确的 kit Go 模块，无效路径立即失败。setup、dev、generate、schema、check、test、coverage 和 build 共用选择，受控 workspace 与代际外部 kit 快照仅位于 .runtime，不改正式 go.mod/go.sum，也不改变 Dashboard 来源。取消本地配置恢复默认。

正式 CI 设置 STARTER_KIT_MODE=installed、GOWORK=off，忽略本地配置并拒绝显式源码覆盖；必须从候选模块 zip 安装并核对版本、sum/goModSum、缓存目录及无 Replace。一次冻结最终应用后执行 setup/generate/check/test/test:go:coverage/build，生成后交付内容变化即失败。成功凭证与正式 kit 核对均匹配才可发布同一快照；失败续跑复用有效凭证，不再导出或验收。.starter.local.json、外部源码和候选状态不随应用交付。
