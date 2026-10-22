# 应用复用与发布

独立仓根只对应主仓 projects/multi-database-demo。Go kit、Dashboard 为固定版本扩展依赖；应用命令实现保存在自己的 scripts 与 tools，随源码导出。公共源码保持包消费边界。应用命令在本目录运行，生成/构建默认 GOWORK=off；主仓开发可使用根 workspace 本地公共包。

复制应用 AGENTS、Trellis workflow/config/scripts/agents/spec/.version/.gitignore 与业务代码；不复制 tasks/workspace/.developer/.runtime、平台配置、凭据、缓存、日志或构建产物。导出白名单控制 Trellis，.npmrc 只保留 registry 地址。

独立发布的 `.vscode/settings.json` 由同步器从同一提交的主仓根目录读取，应用子目录不维护副本，其他根编辑器配置不导出。工具与缓存路径以 `${workspaceFolder}` 为应用根，先执行 setup 安装本应用 `.tools`；发布清单记录实际根来源和哈希，不引入主仓绝对路径。

更新依赖先发布和验收公共包，再更新 package.json/go.mod、独立锁文件及 release-dependencies.json。固定版本、完整性、来源 commit 和逐文件 source/hash 映射由 demo-release.json 记录。旧 source-bundle-v1 可按其管理清单迁移删除；目标独有 CI/文件保留，非管理分支拒绝覆盖，普通 HEAD:branch 推送且重复发布幂等。

2026-10-11 公共能力固定消费：Go kit 使用已合并 main 的 v0.0.0-20261011051254-4d1c52cf70e4；Dashboard 使用正式 0.1.1。精确发布年龄例外仅覆盖两个公司包的固定 0.1.1，不放宽全局依赖策略。功能分支独立验收通过后仍需进入 main，才能同步 GitHub demo。

本目录 Trellis 管应用，主仓共享包/工具/发布任务在根登记，不重复应用任务。验证 get_context.py --mode packages 和 task.py current --source；规范使用本应用相对路径，不沿用主仓工具路径或历史机器绝对路径。

复用时核对模块名、数据模型/迁移、端点/权限、菜单/偏好键、工具版本与数据库运行环境。派生业务仓保留已有迁移和业务提交，依赖与配置逐项升级。

小程序源码 `miniprogram` 与 frontend 同级随应用发布，独立构建产物由微信开发者工具发布。workspace／独立锁文件覆盖两端，codegen 与检查／测试入口覆盖 Admin 前端和 Member 小程序。导出排除微信私有配置、同步归属标记、真实 `.env`、dist 与 `.swc` 编译缓存；保留 `.env.example`。

公共支持脚本与 formatter 在主仓单点维护，工作区通过 scripts/shared_scripts.py 复用根实现；独立导出展开完整本地脚本并交付白名单 tools 源码和同目录单测。派生项目直接修改本地实现，命令保持应用自己的默认 GOWORK=off 与 .tools/.runtime；应用开发监管源码在应用 scripts 自持。

## 显式本地 kit 联调与发布验收

本地 STARTER_KIT_SOURCE 优先于应用根 .starter.local.json 的 kitSource；相对路径以应用根解析，必须是正确的 kit Go 模块，无效路径立即失败。setup、dev、generate、schema、check、test、coverage 和 build 共用选择，受控 workspace 与代际外部 kit 快照仅位于 .runtime，不改正式 go.mod/go.sum，也不改变 Dashboard 来源。取消本地配置恢复默认。

正式 CI 设置 STARTER_KIT_MODE=installed、GOWORK=off，忽略本地配置并拒绝显式源码覆盖；必须从候选模块 zip 安装并核对版本、sum/goModSum、缓存目录及无 Replace。一次冻结最终应用后执行 setup/generate/check/test/test:go:coverage/build，生成后交付内容变化即失败。成功凭证与正式 kit 核对均匹配才可发布同一快照；失败续跑复用有效凭证，不再导出或验收。.starter.local.json、外部源码和候选状态不随应用交付。
