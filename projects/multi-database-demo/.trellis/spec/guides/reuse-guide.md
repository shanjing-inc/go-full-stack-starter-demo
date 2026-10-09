# Trellis 复用与 demo 发布

参考 Node 历史 FEATURE-536：框架可复用，业务事实按 Go 重写，规范必须随 demo 交付。

## 作用域与目录

根 `.trellis` 管共享包、脚本、POC 和发布，config 包名与 spec/包名/层一致；应用 `.trellis` 管 demo。脚本从相应目录运行，避免最近根自动发现选错作用域，同一任务不重复建档。

源仓在 Codeup，MR 按项目云效流程创建，目标分支明确记录；通用 `task.py create-pr` 的 GitHub 默认流程不作为源仓交付入口。GitHub demo 是源码同步目标。

发布是 source-bundle：保留 projects/multi-database-demo、packages、scripts、tools、go.work 与根命令；仅复制应用目录不能独立构建。

## 复制与替换

复制 `.trellis/{workflow.md,config.yaml,scripts,agents,spec,.version,.gitignore}`、AGENTS 项目/Trellis 块。主仓平台适配可自行初始化；公开 demo 不携带上游 .agents/.codex 等平台配置。

不复制 tasks、workspace、.developer、.current-task、.runtime、.template-hashes.json、缓存、会话/worker 状态、密钥和日志。导出用框架白名单，不自动发布新增运行文件。

| 可沿用                                 | 新项目核对/替换                               |
| -------------------------------------- | --------------------------------------------- |
| workflow、脚本、任务/TDD/跨层指南      | config 包名/path/default_package 与 spec 目录 |
| 测试隔离、生成物不手改、服务端权限原则 | Go module/replace/workspace、模型、DB_VERSION |
| adapter 分层、请求取消/校验            | /admin/、菜单、偏好 key、端点/DTO             |
| 固定提交快照与发布白名单               | demo 目录、目标仓/分支、构建上下文            |

禁止残留个人绝对路径、上游任务日志或 Node 业务 API；参考 Node 结构/踩坑，不照搬 Astro/Drizzle/Pothos。

## 验证

根和 demo 分别运行 `rtk proxy python3 .trellis/scripts/task.py current --source`、`rtk proxy python3 .trellis/scripts/get_context.py --mode packages`；新导出目录再跑，核对包路径存在。

导出入口 scripts/sync-go-demo.py 使用固定提交，demo-release.json 记录哈希。重复发布用 detached HEAD 检出 origin/目标分支，普通 HEAD:目标分支推送，不重建默认分支、不 force。

根格式工具扫描嵌套 Trellis 的 MD/YAML/JSON/Python；按现有 Prettier/Ruff 格式化，不改 ignore 掩盖。改代码/命令同步 spec，同次交付并核对发布包确实携带规范。
