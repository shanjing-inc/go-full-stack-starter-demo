# 正式项目 Docker 部署验证

## 1. 状态与范围（2026-10-05）

本轮面向 `/home/dream/wwwroot/go-starter/projects/multi-database-demo`，复用正式 Dockerfile、应用迁移、认证、实时协议和内嵌后台 SPA。旧 `poc/delivery` 与 `scripts/verify-delivery-docker.py` 保留历史验收范围。

| 验收层                                                      | 当前状态                                                           | 证据                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| 当前源码编译 + 正式最终阶段的容器运行                       | 已验证，13 项流程全部通过，退出码 0                                | `offline-runtime` 报告                            |
| 验收脚本回归                                                | 已验证，43 项单测通过                                              | `pnpm test:docker-verifier`，同时接入 `pnpm test` |
| 工程回归                                                    | 已验证，`pnpm check` 与 `pnpm test` 通过，Dashboard 单测 43 项通过 | 格式／Go vet／类型检查、Go／Python／UI 测试       |
| 正式多阶段 Dockerfile 构建 + MySQL／Redis 容器拓扑          | 已验证，14 项流程全部通过，退出码 0                                | `full-build-and-runtime` 报告                     |
| 生产 TLS／反向代理／Secure Cookie、旧库切换、容量与远程发布 | 独立待验收                                                         | 后续生产与发布专项                                |

完整模式首轮通过开始于北京时间 2026-10-05 19:43:19，完成于 19:47:22，脚本记录耗时 233.8 秒；14 条流程全部通过，`cleanupErrors=[]`。完整模式报告的 pending 保留生产专项边界。

完整模式连续第二轮通过于北京时间 2026-10-05 19:47:47–19:48:37，脚本记录耗时 48.15 秒；14 条流程全部通过，`cleanupErrors=[]`，验证缓存构建、随机独立资源和重复执行清理。

离线运行阶段已连续通过三轮。最新已通过一轮开始于北京时间 2026-10-05 18:40:23，完成于 18:40:52，脚本记录耗时 28.09 秒；13 条流程全部通过，`cleanupErrors=[]`。

环境实测：WSL2／Ubuntu 24.04，Docker Engine 29.1.3，宿主机 Go 1.26.8 linux/amd64，完整模式容器 MySQL 8.0.46／Redis 7.0.15，离线模式隔离宿主 MySQL 8.0.46-0ubuntu0.24.04.4，迁移版本 `202610040001`。正式 Dockerfile SHA256 为 `f4ebb54fb145926dd5c9c97ced046baa476a09d2db5338f42fc8147e106f7d58`。

## 2. 两种执行模式

从仓库根目录执行。共同前提为 Docker Engine 可访问，以及 `pnpm setup` 已准备项目 Go／Atlas／依赖。完整模式的实时测试仍使用宿主机 Go，Atlas 从宿主机连接临时发布的 MySQL 回环端口。

```bash
cd /home/dream/wwwroot/go-starter
rtk pnpm test:docker-verifier
rtk pnpm verify:docker
```

完整模式依次拉取 `/home/dream/wwwroot/go-starter/projects/multi-database-demo/docker-images.json` 中的 Node、Go、MySQL 和 Redis 镜像，核验对应来源的 RepoDigest，以摘要固定本轮构建与依赖启动；再执行正式多阶段构建、创建专用 bridge 网络、MySQL／Redis 容器、双 Web 与独立 Worker。对宿主机发布的 Web 与 MySQL 端口仅绑定 `127.0.0.1`。

镜像拉取受阻时，可独立执行运行阶段验收：

```bash
rtk pnpm verify:docker --runtime-only
```

该模式需要宿主机 `mysqld`、`mysql`、`redis-server`、`redis-cli` 和 `file`。脚本从当前源码执行 `pnpm build`，检查 Web／Worker 静态链接，从正式 Dockerfile 唯一 `FROM scratch` 阶段提取运行定义，保留 USER／CMD／SIGTERM 等元数据，以本地构建上下文和 `--network=none` 创建应用镜像。MySQL／Redis 使用脚本专属临时数据目录和随机回环端口；应用容器使用 host 网络连接这组隔离依赖。

运行阶段报告的 `pending` 始终保留正式多阶段构建和依赖容器拓扑。完整模式在对应步骤实际通过后更新待验收清单。

### WSL 用户组刷新

新终端取得 docker 组权限后直接运行上述命令。当前 Codex 进程仍保留旧组列表时，通过 `sg` 在子进程刷新组权限：

```bash
rtk proxy sg docker -c 'pnpm verify:docker --runtime-only'
rtk proxy sg docker -c 'pnpm verify:docker --pull-timeout 60'
```

## 3. 完整模式 14 项已验证流程

1. Node／Go／MySQL／Redis 四个镜像实际拉取，来源匹配与 SHA256 摘要核验。
2. 正式 Dockerfile 多阶段构建，容器内安装前端依赖、构建 SPA、下载与校验 Go 模块、编译 Web／Worker。
3. 镜像 USER 为 `65532:65532`，默认入口为 `/web`，StopSignal 为 SIGTERM，架构为 amd64。
4. 独立 MySQL 8.0／Redis，正式 Atlas 迁移连续应用两次，两方言版本一致；Web 使用业务表读写权限，Worker 使用只读数据库账户。
5. 双 Web 与独立 Worker 使用同一镜像 ID；非 root、只读根文件系统、`cap-drop=ALL` 和 `no-new-privileges`。
6. 真实初始化 owner、邮箱登录、Cookie／Bearer 跨 Web 容器共享、退出后的跨容器会话撤销。
7. 受限 Web 账户通过 Admin GraphQL 写入店铺，另一容器通过双 Schema 和 REST 读取相同记录。
8. `/admin/shops` 与 `/admin/users` 深链返回内嵌 SPA，真实 JS／CSS 资源可读取，未知 API 路径返回 404。
9. Web 投递任务，独立 Worker 完成一次副作用，另一 Web 的重复任务返回 409。
10. 复用正式 `TestExternalWebProcesses`，跨容器 WebSocket 广播、设备查询 SSE、连接资源释放实际执行；要求通过记录且零 skip。
11. 隔离库的 Atlas applied 状态故障触发双 Web readiness 503，liveness 保持 200；恢复迁移状态后 readiness 回到 200。
12. 有效配置 Web 使用独立端口启动、达到 ready 并优雅退出，作为门禁正向对照；Web／Worker 的错误版本、无效 APP_MODE、缺失迁移用例分别使用独立端口，断言退出码 1 与对应的结构化错误原因；缺失迁移的隔离库保持零表。
13. `APP_MODE=production`、HTTPS Origin 配置、清空初始化密钥的 Web 容器启动并达到 ready；该项覆盖配置与启动。
14. 生产配置 Web、双 Web 和 Worker 接收 SIGTERM，退出码为 0，`OOMKilled=false`。

离线模式以“宿主机编译源码与正式最终阶段构建”替换前两项，继续执行后续 12 项，共 13 项流程。

`pnpm test` 本轮显式清空外部 MySQL／Redis／Web 测试环境变量，执行快速 Go／Python／UI 回归；对应外部依赖用例按现有规则跳过。Docker 的真实数据库与跨容器实时验收由上述独立流程提供证据。工程测试日志为 `/home/dream/wwwroot/go-starter/.runtime/project-docker-regression-test.log`，检查日志为 `/home/dream/wwwroot/go-starter/.runtime/project-docker-regression-check.log`。

这组验收覆盖应用容器运行、真实数据库账户与跨实例行为。容器内浏览器 E2E、race detector、Redis 故障恢复、Web 强杀后的长连接故障以及高并发容量保持各自独立验证范围。

## 4. 报告、退出码与资源边界

- 完整模式最新报告：`/home/dream/wwwroot/go-starter/.runtime/project-docker-result.json`。
- 运行阶段最新报告：`/home/dream/wwwroot/go-starter/.runtime/project-docker-runtime-result.json`。
- 每轮独立目录：`/home/dream/wwwroot/go-starter/.runtime/project-docker-<随机值>/`，保存 `result.json`、Docker 命令和构建／迁移／实时测试日志。
- 完整模式第二轮已通过独立报告：`/home/dream/wwwroot/go-starter/.runtime/project-docker-n503lkpw/result.json`。
- 完整模式首轮已通过独立报告：`/home/dream/wwwroot/go-starter/.runtime/project-docker-lmashftb/result.json`。
- 已通过运行阶段独立报告：`/home/dream/wwwroot/go-starter/.runtime/project-docker-9is7d55d/result.json`。

退出码 0 表示所选 scope 通过；1 表示构建／业务／断言失败或清理失败；2 表示 Docker 权限、工具缺失或镜像下载网络环境受阻。清理失败会把通过状态改为 failed，并在 `cleanupErrors` 记录原因。

每轮使用随机唯一容器名、网络名、镜像 tag、业务命名空间与凭据。临时目录权限为 0700，envfile 为 0600；可控的命令输出隐藏密码、认证密钥、token 和签名下载 URL 的查询参数。结束时清理本轮容器及匿名卷、专用网络、应用镜像、隔离依赖进程和 envfile。日志采集及写盘与容器删除分别处理错误，日志故障仍会执行容器删除。失败分支也执行清理；明确不存在的自有资源按已清理处理，其余错误进入报告。验收期间收到 SIGTERM 时进入受控失败退出，完成资源清理、删除 envfile 并生成报告，退出码为 1；清理期间的后续 SIGTERM 暂时忽略，执行结束恢复原有信号处理器。`--keep-image` 显式保留本轮应用镜像，四个拉取的基础镜像作为 Docker 缓存保留。

独立日志目录及其中的隔离数据库文件、离线构建上下文作为本地诊断产物保留，具有敏感数据边界。运行报告和日志目录由 `.gitignore` 排除。实际应用 `.env`、现有数据库和系统 DNS 保持原状。Docker daemon 新增独立的开发代理 drop-in，配置和回退方法见第 5 节。

## 5. WSL 宿主代理与重跑

本机实测 `http://127.0.0.1:7897` 可访问 Docker Hub 与 npm Registry。Docker Registry `/v2/` 经代理返回 401，npm Registry 经代理返回 200；对应的认证与包下载连接已建立。

本轮新增 `/etc/systemd/system/docker.service.d/development-proxy.conf`：

```ini
[Service]
Environment="HTTP_PROXY=http://127.0.0.1:7897"
Environment="HTTPS_PROXY=http://127.0.0.1:7897"
Environment="NO_PROXY=localhost,127.0.0.1,::1"
```

新增配置前确认运行容器列表为空，随后执行 daemon-reload 与 Docker 服务重启。当前用户具备 docker 组权限；本发行版 root 管理操作通过以下入口完成：

```bash
rtk proxy wsl.exe -d Ubuntu -u root -- systemctl daemon-reload
rtk proxy wsl.exe -d Ubuntu -u root -- systemctl restart docker
rtk proxy docker info --format 'HTTPProxy={{.HTTPProxy}} HTTPSProxy={{.HTTPSProxy}}'
```

服务重启会影响正在运行的容器，执行前确认业务维护窗口。此 drop-in 持续生效，镜像拉取依赖宿主代理服务可用。撤销本轮代理配置时删除这一独立文件，再重新加载与重启：

```bash
rtk proxy wsl.exe -d Ubuntu -u root -- rm /etc/systemd/system/docker.service.d/development-proxy.conf
rtk proxy wsl.exe -d Ubuntu -u root -- systemctl daemon-reload
rtk proxy wsl.exe -d Ubuntu -u root -- systemctl restart docker
```

### 构建阶段代理

```bash
cd /home/dream/wwwroot/go-starter
rtk proxy pnpm verify:docker --build-proxy http://127.0.0.1:7897 --pull-timeout 300
```

`--build-proxy` 同时为本轮 Docker CLI 子进程配置大小写 HTTP(S) 代理变量，以及为 Dockerfile 的 RUN 传入预定义 HTTP_PROXY／HTTPS_PROXY／NO_PROXY build args。BuildKit 认证回调使用 CLI 的代理环境；daemon 拉取镜像使用上述 systemd 配置。脚本保持父进程环境和应用配置原状。

启用该参数时，构建使用 `--network=host`，让 RUN 可连接宿主回环代理。MySQL／Redis、双 Web 与 Worker 的运行使用本轮专用 bridge 网络。运行镜像元数据额外检查代理环境变量边界；报告记录 `buildProxy` 与 `buildNetwork`。

该参数仅接受无凭据、无 query／fragment 的 HTTP(S) URL。`--runtime-only` 采用独立离线运行范围，其参数要求 registry 与 build-proxy 为空。

### 镜像来源与历史阻塞证据

脚本支持显式镜像来源前缀和单次拉取超时：

```bash
# 前缀格式为 host[:port][/path]，例如官方公开 ECR 来源。
rtk proxy pnpm verify:docker --registry public.ecr.aws/docker/library --pull-timeout 120
```

`--registry` 替换四个基础／依赖镜像引用。正式 Dockerfile 的 `# syntax=docker/dockerfile:1` 及 npm／Go 模块下载使用各自下载链路；完整验收要求这些链路同时可达。来源引用、实际摘要与镜像 ID 进入报告，源不一致或无效摘要触发失败。

- 2026-10-05 18:34:10–18:34:42（北京时间）：Node manifest 下载超时，退出码 2，清理错误为零。历史报告保留在 `/home/dream/wwwroot/go-starter/.runtime/project-docker-d9ifps8h/result.json`。
- 2026-10-05 19:37:26 开始的一轮：daemon 代理已支持四个基础镜像下载与摘要核验；BuildKit 的 Dockerfile 前端认证请求超时，退出码 2，清理错误为零。历史报告保留在 `/home/dream/wwwroot/go-starter/.runtime/project-docker-di_8o5ek/result.json`。
- 后续诊断为 Docker CLI 单独传入代理，Dockerfile 前端实际下载成功；对应修复加入脚本，并补充代理环境隔离单测。

## 6. 审查修复与回归（2026-10-05）

本轮修复 `/home/dream/wwwroot/go-starter/scripts/verify-project-docker.py` 的三项审查问题：

1. 日志采集超时或写盘失败后，继续删除自有容器与匿名卷；诊断错误进入 `cleanupErrors`，验收状态记为 failed。
2. 验收期间接收 SIGTERM 后执行统一清理并生成失败报告；清理期间屏蔽后续 SIGTERM，执行结束恢复原处理器。
3. 启动门禁增加有效 Web 配置的就绪与优雅退出正向对照，为各用例分配独立端口，并精确匹配 Web／Worker 的结构化错误原因，覆盖版本、模式和缺失迁移三类失败。

`/home/dream/wwwroot/go-starter/scripts/test-verify-project-docker.py` 新增 8 项回归，总计 43 项通过：覆盖日志超时、写盘失败、清理后失败报告、信号处理器恢复、真实子进程连续 SIGTERM，以及门禁端口隔离、监听错误拒绝和正向对照就绪要求。真实信号测试同时检查依赖进程退出、envfile 删除和两份失败报告一致。

额外使用真实 Docker 容器验证 SIGTERM：脚本退出码 1，报告状态 failed，容器与 envfile 均已删除，`cleanupErrors=[]`。工程 `pnpm check`、`pnpm test` 均通过，Dashboard 单测 43/43 通过。

下表时间采用北京时间 2026-10-05：

| 验收     | 结果                                     | 时间与独立报告                                                                                                      |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 完整模式 | 14/14 通过，退出码 0；`cleanupErrors=[]` | 22:53:36–22:54:42，脚本耗时 62.48 秒；`/home/dream/wwwroot/go-starter/.runtime/project-docker-gitj92fk/result.json` |
| 离线模式 | 13/13 通过，退出码 0；`cleanupErrors=[]` | 22:53:36–22:54:06，脚本耗时 28.5 秒；`/home/dream/wwwroot/go-starter/.runtime/project-docker-db_d_2j9/result.json`  |

本轮检查、工程测试、脚本回归、真实 Docker 信号测试及两种模式的控制台日志保存在 `/home/dream/wwwroot/go-starter/.runtime/project-docker-review-fix-w0j854w7/`。两种模式的完整验收同时通过；生产 TLS／反向代理／Secure Cookie、真实旧库切换、race、容量等专项维持既有边界。
