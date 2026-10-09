# 应用复用与发布

独立仓根只对应主仓 projects/multi-database-demo。Go kit、Dashboard、devtools 为固定版本扩展依赖；源码不复制到 packages/vendor，不依赖相邻 checkout。应用命令在本目录运行，生成/构建 GOWORK=off；主仓开发可使用根 workspace 本地公共包。

复制应用 AGENTS、Trellis workflow/config/scripts/agents/spec/.version/.gitignore 与业务代码；不复制 tasks/workspace/.developer/.runtime、平台配置、凭据、缓存、日志或构建产物。导出白名单控制 Trellis，.npmrc 只保留 registry 地址。

更新依赖先发布和验收公共包，再更新 package.json/go.mod、独立锁文件及 release-dependencies.json。固定版本、完整性、来源 commit 和逐文件 source/hash 映射由 demo-release.json 记录。旧 source-bundle-v1 可按其管理清单迁移删除；目标独有 CI/文件保留，非管理分支拒绝覆盖，普通 HEAD:branch 推送且重复发布幂等。

本目录 Trellis 管应用，主仓共享包/工具/发布任务在根登记，不重复应用任务。验证 get_context.py --mode packages 和 task.py current --source；规范使用本应用相对路径，不沿用主仓工具路径或历史机器绝对路径。

复用时核对模块名、数据模型/迁移、端点/权限、菜单/偏好键、工具版本与数据库运行环境。派生业务仓保留已有迁移和业务提交，依赖与配置逐项升级。
