# 运行产物与 Go 缓存清理

## 范围与入口

本方案管理仓库的 `/home/dream/wwwroot/go-starter/.runtime` 和 `/home/dream/wwwroot/go-starter/.tools/gocache`。工具链、GOPATH 模块下载、浏览器依赖、开发数据库、人工调查目录和备份各自保留。

```bash
rtk pnpm clean:runtime --dry-run
rtk pnpm clean:runtime
rtk pnpm clean:cache --dry-run
rtk pnpm clean:cache
rtk pnpm clean:all
rtk pnpm test:cleanup
```

预览以 JSON 列出候选项、保护原因与预计回收量，全程保持文件原样。正式清理记录位于 `/home/dream/wwwroot/go-starter/.runtime/cleanup-latest.json`，缓存单独检查的结果直接打印。占用按已分配磁盘块计算，硬链接去重，符号链接仅计链接自身；预计回收量受保留目录中的共享硬链接影响，以实际磁盘变化为准。

## 生命周期与保留规则

开发、普通项目验收、Docker／PostgreSQL 验收创建目录时记录 `retention.json`，持有 `.run.lock`。所有受管 Go 工程命令和上述运行生命周期持有共享缓存锁，锁位于真实缓存旁的 `.tools/.gocache-clean.lock`。

| 场景                             | 大产物                             | 报告、日志和状态       |
| -------------------------------- | ---------------------------------- | ---------------------- |
| 项目或 Docker 验收成功           | 所属进程清理完成后立即回收         | 保留 7 天              |
| 开发正常退出                     | 所属进程清理完成后立即回收         | 保留 7 天              |
| 验收失败、环境阻塞、开发启动失败 | 完整现场保留 48 小时，之后回收     | 保留 14 天             |
| 异常中断、所有者已退出           | 兜底首次确认时开始 48 小时保留窗口 | 保留 14 天             |
| 文档引用、最近结果入口引用       | 按上述期限回收大产物               | 保留引用的证据目录     |
| 资源清理失败                     | 完整现场继续保留                   | 确认资源已退出后再处理 |
| 显式保留                         | 完整现场持续保留                   | 持续保留               |

普通项目的回收范围为源码快照、临时 MySQL 和编译目录；Docker 验收的回收范围为临时 MySQL、运行镜像上下文、临时 schema diff 工作目录与编译目录；开发回收范围为前端构建、Vite 缓存、各代源码及二进制。开发代目录的 `*.log` 在回收前复制到原运行目录。

成功回收后，`retention.json` 写入 `artifactsCleanedAt` 和 `artifactsRetained=false`。原 `result.json` 保留验收当时的内容，历史源码快照路径由保留记录说明当前可用性。

开发退出时，最新 Go 编译状态为 `build-failed` 的运行按失败规则保留完整现场 48 小时；正常运行退出沿用即时回收规则。

启动兜底的 `sweptAt` 使用有限、非负且已发生的数值时间。异常字段使本轮自动清理延后并告警，开发和验收继续执行；运行目录与原清理记录保持原样。执行 `rtk pnpm clean:runtime` 可按各目录的保留规则清理并重建兜底记录，后续启动恢复每小时检查。

启动兜底每小时执行一次，负责历史目录和异常中断；本次运行退出时的回收独立执行。运行目录超过 5 GiB 时打印预警，活跃运行和保护项继续保留。清理失败单独告警，业务命令保持自身退出状态；资源退出失败继续保留运行现场。

## 显式保留与旧目录

```bash
rtk pnpm dev --keep-runtime
rtk pnpm verify --keep-runtime
rtk pnpm verify:docker --runtime-only --keep-runtime
rtk pnpm verify:postgresql --keep-runtime
```

需要长期保留现有目录时，在该目录内创建 `.keep-runtime` 标记。新运行的 `--keep-runtime` 记录于 `retention.json`。恢复自动清理时，移除标记并将记录中的 `keepRuntime` 设为 `false`。

旧目录仅自动识别脚本的随机名称及其可信完成记录：`project-xxxxxxxx`／`project-docker-xxxxxxxx` 要求 `result.json` 的运行路径匹配目录；`dev-xxxxxxxx` 要求 `state.json` 记录 `stopped`／`failed` 且原监管 PID 已退出。人工备份、缺失／损坏记录和其他目录在预览中列为保护项，逐项确认后处理。

## Go 缓存容量与隔离构建

容量阈值为 12 GiB。超过阈值时，主仓库入口取得缓存排他锁，确认 Go 编译、链接和语言服务进程处于退出状态，再使用项目内 Go 的 `clean -cache` 回收。活跃 Go／语言服务进程或共享锁使本次回收延后，预览及启动提示会说明原因。语言服务运行期间可持续减少运行目录占用；关闭当前仓库的 Go 语言服务后执行 `rtk pnpm clean:cache` 完成缓存回收。

源码快照共享缓存锁和缓存本身，缓存回收统一从主仓库执行。隔离验收对子任务设置 `STARTER_ISOLATED_BUILD=1`，Go 工程入口在已有 `GOFLAGS` 上添加 `-trimpath`；显式的 `-trimpath` 配置保持优先。开发代际构建使用 `-trimpath`，正式生产构建沿用已有配置，减少随机源码路径产生的缓存变体。编译产物中的源码路径采用模块路径，调试和堆栈定位按该路径解析。

首次缓存回收后，下一轮构建需要重新编译缓存缺失项。自动清理和手动入口采用同一容量规则。

## 安全边界与验证

- `.runtime` 使用仓库内真实目录，回收路径限定于直属运行目录和预定义产物。
- 活跃租约、PID 启动身份、系统启动身份、进程工作目录、可执行文件、命令参数和打开文件共同参与保护判断。
- 回收期间持有排他运行锁，删除前重新检查进程引用和保留标记；共享依赖符号链接按链接自身处理。
- Go 缓存锁协调正式工程及开发／验收入口；第三方工具通过进程检查采用保守保护。
- 手动入口报告删除或缓存回收错误；启动与退出阶段使用独立告警保留业务结果。

针对性测试覆盖成功／失败期限、异常退出、PID 复用、文档和最近报告保护、显式保留、租约锁、符号链接、共享缓存锁、阈值与官方命令、只读预览、开发与验收生命周期。完整浏览器、Docker 多阶段构建和生产部署继续按各自验收范围执行。
