# Go 后端替换版脚手架架构规划

- 规划日期：2026-10-02；复用定位与 POC 进度更新：2026-10-03；邮箱认证迁移更新：2026-10-04。
- 工作目录：`/home/dream/wwwroot/go-starter`。
- 当前阶段：正式工程与 R0／R1 邮箱认证迁移；本文记录已确认决策、建议布局和实施进度。
- 实现状态：数据库、Web、实时、Worker、开发产物共五组独立 POC、宿主机统一开发入口和 Dockerfile 已实施；正式公共 Go 包、应用模板与 demo 整合待实施。
- 验证状态：数据库 29 项、Web 18 项、实时 14 项、Worker 21 项流程检查通过；开发产物宿主机验收通过 25 项流程检查和 152 次叶级 Go 测试。Docker 构建／运行处于环境阻塞状态，race detector 待具备 C 编译器的环境；完整业务替换与生产验收留在后续阶段。
- Git 状态：仓库已初始化，当前分支 main；用户已创建 Codeup 远程仓库，origin 已配置。2026-10-03 已按用户授权完成首次提交 c2693fa；用户手动推送后，ssh-agent 只读检查确认远程 main 与本地提交一致。后续提交及推送分别确认授权。
- 后续实施、任务创建及提交分别确认授权。

## 1. 目标与范围

### 1.1 核心目标

以现有脚手架的能力、接口协议和数据库结构为基线，开发 Go 后端替换版，将 Node.js 专有的后端组件换成 Go 对应方案。

参考项目：

- 仓库：`/home/dream/wwwroot/astro-full-stack-starter`。
- 共享源码：`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src`。
- 数据模型参考：`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/db/mysql`。
- 协议与功能参考：上述共享源码中的 GraphQL、队列、Redis、Bus、WebSocket 和后台模块；实施时建立逐项兼容清单。SSE 根据 Go 原生能力独立设计。

### 1.2 首版范围

- Go 提供 REST、GraphQL、WebSocket、SSE 和异步任务处理。
- 后台保持 SPA，与 Go 后端同仓库，分别开发和构建。
- 主要用户端为微信小程序和 App；登录页面可以放在 SPA 中。
- 个别公开网站页面的 SEO／SSR 按项目需要处理，前端方案另行规划。
- 直接接入现有 MySQL 表结构和数据。
- 支持 Web、Worker 多实例运行；初始部署各启动一个副本，后续按负载扩容。
- 保留现有 Redis 缓存、锁、Bus 广播与查询，以及后台相关能力的兼容性目标。

### 1.3 首版范围之外

- 手机号登录、短信验证码、手机号绑定及相关新增字段。
- 既有 BullMQ 中待执行任务的接续处理。
- Redis Cluster 分片集群。
- 后台动态新增定时任务或修改 cron 表达式。
- Node.js 与 Go 的上线切换、双跑及流量迁移流程。
- 数据库版本升级与其他数据库／运行平台适配。

以上事项移出首版规划范围；现有数据库结构与数据兼容仍属于首版目标。

### 1.4 团队复用定位（已确认）

项目定位为基于 Echo 的团队全栈开发脚手架，延续参考仓库 `labs/astro-full-stack-starter` 的公共包与 demo 复用思路。Echo 提供底层 Web 框架能力，脚手架整合数据库、GraphQL、实时通信、Worker、后台 SPA、开发与发布链路。

已确认采用三层组织：

- **公共 Go module**：业务项目以依赖方式使用公共后端能力，公共接口和版本兼容作为交付内容。
- **应用模板**：用于创建业务项目，包含 Web／Worker 入口、业务结构、前端接入、生成、迁移、开发及构建配置；项目创建后维护自身业务代码与配置。
- **demo**：通过可运行应用展示公共能力和典型扩展方式，同时承担集成与回归验收。

公共基础能力、通用账号／权限以及队列／调度管理等系统功能归入公共 Go 框架 go-server-kit；前端公共包定位为 Dashboard 框架，以 @shanjing/shadcnui-dashboard 作为 npm 包名分发。业务项目维护自身业务代码、业务表与迁移、页面和运行配置。

首版维护一个完整 Go + MySQL demo，并以它作为应用模板来源；demo 与模板共用维护主线。仓库采用 packages + projects：公共 Go 包放在 packages/go-server-kit，前端 npm 包放在 packages/shadcnui-dashboard，完整示例放在 projects/multi-database-demo。仓库名已确定为 labs/go-full-stack-starter，托管于 Codeup 的 shanjing/labs/go-full-stack-starter；公共框架名称已确认：后端 go-server-kit，前端 @shanjing/shadcnui-dashboard；公共后端 module 路径已确认，发布及模板导出方式继续细化。当前 POC 保留为工程整合的验证依据。

## 2. 已确认决策

| 领域             | 决策                                       | 说明                                                                                                                                                    |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 复用交付         | 公共 Go module + 应用模板 + demo           | 面向团队复用；前端共享组件继续通过 npm 包分发。                                                                                                         |
| 公共系统功能     | 通用账号／权限、队列／调度管理             | 以公共模块供业务项目复用；标准模型由公共库维护、最终迁移由应用维护；具体接口、模型定义与权限策略另行细化。                                              |
| demo 与模板      | 一个完整 Go + MySQL demo，作为应用模板来源 | 共用维护主线；模板导出方式、示例业务取舍及生成后验收继续细化。                                                                                          |
| 仓库组织         | packages + projects                        | packages/go-server-kit 为公共 Go 包，packages/shadcnui-dashboard 为前端 npm 包，projects/multi-database-demo 为完整示例；保留 scripts、poc、docs。      |
| 仓库命名         | labs/go-full-stack-starter                 | 与 labs/astro-full-stack-starter 对应；当前本地目录保持 /home/dream/wwwroot/go-starter。                                                                |
| 后端公共框架名称 | go-server-kit                              | 公共包目录 packages/go-server-kit 及完整 Go module 路径已确认，见第 4.8 节。                                                                            |
| 前端 npm 包名    | @shanjing/shadcnui-dashboard               | 公共 Dashboard 框架。                                                                                                                                   |
| 代码托管         | 阿里云 Codeup                              | 用户已创建 shanjing/labs/go-full-stack-starter，origin 已配置，ssh-agent 只读访问已通过；公共后端 module 路径已确认；依赖获取与发布方式继续验证或确认。 |
| Web 框架         | Echo v5                                    | 承担 HTTP 路由、中间件和连接入口；Web POC 固定 v5.4.0，端点接入已验证。                                                                                 |
| GraphQL          | gqlgen                                     | Schema 驱动代码生成，Resolver 调用业务 Service。[1] Web POC 固定 v0.17.95，多端点、错误与 batching 已验证。                                             |
| 进程入口         | Web、Worker                                | 两类独立进程，共享业务模块与基础设施。                                                                                                                  |
| WebSocket        | coder/websocket                            | Web 内运行，连接生命周期纳入统一管理。                                                                                                                  |
| SSE              | Echo + Go 标准库 net/http                  | 使用 ResponseController、逐条刷新、有界写入期限和请求取消；流事件协议独立设计。                                                                         |
| 生产数据库       | MySQL 8.0                                  | 兼容现有表与数据；具体补丁版本在验收环境固定。                                                                                                          |
| 本地自动化测试   | SQLite                                     | 自动建表并清理；真实 MySQL 集成测试覆盖生产行为。                                                                                                       |
| 数据访问         | GORM + Gen                                 | Go struct 定义持久化模型，Gen 生成类型化查询代码。[2]                                                                                                   |
| 数据库迁移       | Atlas 社区版                               | 完全开源、无需第三方账号；依赖准备完成后离线使用为验收要求。                                                                                            |
| 迁移生成         | 模型导出 SQL，再计算差异                   | GORM Schema 导出程序与 Atlas 分两步执行，封装成统一命令；两表兼容样例已通过 POC，完整业务库接入待验证。                                                 |
| 迁移执行         | 独立命令显式执行                           | Web、Worker 启动时检查数据库版本。                                                                                                                      |
| Redis 客户端     | go-redis                                   | Cache、Lock、Bus 按用途封装；与队列统一连接配置。                                                                                                       |
| 任务队列         | Asynq                                      | Redis 支撑队列，Worker 独立消费；业务处理需满足幂等要求。[3]                                                                                            |
| 定时任务         | Go 代码定义                                | cron 表达式和时区随版本发布；调度运行在 Worker 内。                                                                                                     |
| 定时任务后台管理 | 查看、启停、手动触发                       | 多实例共享控制状态；控制状态的存储方式待细化。                                                                                                          |
| 配置             | 环境变量                                   | 本地通过 .env 加载；Web、Worker 共用类型化配置并在启动时校验。                                                                                          |
| 日志             | Go 标准库 slog                             | 开发输出文本，生产输出 JSON；过滤或脱敏敏感字段。                                                                                                       |
| 依赖管理         | 显式构造函数注入                           | 启动入口组装依赖，业务测试通过接口替换外部依赖。                                                                                                        |
| 本地开发         | 全部在宿主机运行                           | MySQL、Redis 为本机服务；SPA、Web、Worker 为宿主机开发进程。                                                                                            |
| 热重载           | Air                                        | Web、Worker 各自使用独立配置和编译输出目录。                                                                                                            |
| 开发入口         | 统一开发命令                               | 启动 SPA、Web、Worker，并统一管理子进程退出。                                                                                                           |
| 生产静态资源     | go:embed                                   | SPA 产物内嵌到 Web 二进制，与 Web 同版本发布。[4]                                                                                                       |
| 生产打包         | Docker 多阶段构建                          | 构建阶段完成 SPA 和 Go 编译，运行镜像保留运行所需文件。                                                                                                 |
| 镜像与容器       | 同一镜像、独立容器                         | 镜像包含 Web、Worker；以不同启动命令运行，各自配置副本数。                                                                                              |

## 3. 运行架构

```text
后台 SPA / 微信小程序 / App / 公开页面
                     │
                HTTP 入口
                     │
          ┌──────────┴──────────┐
          │                     │
        Web 1                 Web N
 REST / GraphQL / WebSocket / SSE / 内嵌后台 SPA
          │                     │
          ├──── 共享业务 Service ┤
          │                     │
          ├── MySQL 8.0：业务数据、既有表与迁移版本
          └── Redis：缓存、锁、Bus、任务队列
                                │
                      ┌─────────┴─────────┐
                      │                   │
                    Worker 1           Worker N
                      │                   │
                      └──── 业务 Service ─┘
                      队列消费 / 定时调度
```

### 3.1 Web 职责

- 提供 REST 和 GraphQL，集中完成协议层参数解析、认证上下文传递及错误转换。
- 托管后台 SPA 生产资源，区分 API 路由、静态资源和 SPA 页面回退。
- 维护本实例 WebSocket／SSE 连接，通过 Bus 完成跨实例消息转发。
- 按业务需要投递异步任务。

### 3.2 Worker 职责

- 消费 Asynq 队列，调用共享业务 Service。
- 加载代码定义的定时任务，协调多个副本的调度权。
- 记录任务状态、错误与执行结果，兼容后台所需的查询和管理能力。

### 3.3 建议的生命周期约定

以下细节进入 POC 和实现设计：

- 统一初始化配置、日志、数据库和 Redis，各入口按职责装配服务。
- 使用标准 context 传递取消、超时和请求／任务上下文。
- 退出时停止接入新请求或任务，并在配置的期限内完成连接与资源清理。
- WebSocket、SSE、Bus 订阅和 Worker 处理器分别实现可重复调用的清理逻辑。
- 健康检查、就绪状态和退出期限与 Docker 运行配置配套验证。

## 4. 复用边界与建议工程布局

### 4.1 复用职责划分（职责归属已确认，接口待细化）

| 归属                       | 建议提供的内容                                                                                                                              | 扩展与维护职责                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公共 Go 基础包             | 类型化公共配置、日志、生命周期、数据库／Redis 连接、Cache／Lock／Bus、队列与调度基础能力、Echo／GraphQL／WS／SSE 的公共适配、迁移版本门禁。 | 公共包维护稳定接口及兼容测试；应用显式组装依赖、注册路由与处理器，并配置超时、资源及运行策略。                                                            |
| 公共功能模块（归属已确认） | 多项目共用的账号／权限、队列／调度管理等通用后台能力及对应协议。                                                                            | 模块封装自己的行为与持久化契约，业务项目通过配置或扩展接口接入；公共库维护标准模型，应用统一维护最终迁移；认证四表与邮箱认证已落地，完整权限策略进入 R2。 |
| 前端 npm 包                | Dashboard 框架的布局、导航与通用后台组件，客户端请求与实时通信适配、公共功能模块的前端接入能力。                                            | 公共包维护前后端接口契约；项目维护自身页面、路由、主题与业务交互。                                                                                        |
| 业务应用／模板             | Web／Worker 入口与依赖装配、业务 Service、REST／GraphQL 适配、业务模型与 Gen 查询、业务迁移、任务／调度定义、SPA 资源嵌入与运行配置。       | 模板提供初始结构；业务项目维护创建后的代码、数据库演进与部署配置。                                                                                        |
| demo                       | 公共能力组合与扩展示例、端到端流程及发布依赖验收。                                                                                          | demo 保持可复现，公共能力修复进入公共包，业务样例随示例维护。                                                                                             |

业务应用依赖公共 Go 包，公共包围绕调用方提供的接口、配置及注册入口组织依赖。项目专有业务模型与生成代码由项目维护，通用功能模块的标准模型与业务专有模型分别管理。

对外复用能力放在公开 Go 包，包内实现细节使用 internal；业务应用的内部代码使用自己的 internal。Go 官方布局文档说明了公开包与 internal 的导入边界。[12]

### 4.2 业务应用布局（建议）

以下树描述应用模板或 demo 内部结构；仓库级路径见第 4.5 节。包内细节和应用模板导出方式继续细化。

```text
<业务应用目录>/
├── cmd/
│   ├── web/                        # Web 启动入口
│   └── worker/                     # Worker 启动入口
├── internal/
│   ├── bootstrap/                  # 依赖组装、启动与资源关闭
│   ├── config/                     # 类型化配置与校验
│   ├── modules/                    # 按业务模块组织
│   │   └── 示例模块/
│   │       ├── service.go          # 业务逻辑
│   │       ├── rest.go             # REST 适配
│   │       ├── graphql.go          # GraphQL 业务适配
│   │       ├── tasks.go            # 任务定义与处理适配
│   │       └── schedules.go        # 定时任务定义
│   ├── platform/
│   │   ├── database/
│   │   │   ├── model/              # GORM 持久化模型
│   │   │   └── query/              # Gen 生成的类型化查询
│   │   ├── redis/                  # 公共客户端配置与项目装配
│   │   ├── cache/                  # 公共缓存接入与项目扩展
│   │   ├── lock/                   # 公共锁能力接入
│   │   ├── bus/                    # 公共 Bus 装配与业务绑定
│   │   ├── queue/                  # 公共队列接入与项目任务策略
│   │   └── logging/                # 公共日志接入与业务字段
│   └── transport/
│       ├── http/                   # Echo、中间件、REST 与静态资源路由
│       ├── graphql/                # Schema、gqlgen 生成代码与根 Resolver 装配
│       ├── websocket/              # 连接适配、协议分派与 Bus 桥接
│       └── sse/                    # 流式响应与连接清理
├── frontend/
│   └── admin/                      # 后台 SPA，沿用现有前端工具链
├── migrations/                     # 已审核版本化 SQL 和校验文件
├── tools/                          # Gen、Schema 导出等构建期工具
├── scripts/                        # 开发、生成、测试、构建与迁移入口
├── tests/
│   ├── integration/                # MySQL、Redis、队列等集成验证
│   └── compatibility/              # 接口、消息和既有数据兼容验证
├── deploy/                         # Docker 构建与生产运行示例
└── docs/
    └── architecture-plan.md        # 当前规划文档
```

### 4.3 布局与依赖约定

以下约定应用于业务应用层：

- 模块集中维护业务 Service 及自身协议适配，公共基础设施分别封装。
- 项目专有持久化模型集中放在应用数据库模型包，项目 Gen 查询依赖该模型包；公共功能模块标准模型由公共库维护，应用组合模型并统一维护最终迁移，见第 5.2.1 节；具体模型接入继续细化。
- gqlgen 根 Resolver 负责装配，模块负责业务；多 Schema／端点的生成布局通过 POC 确定。
- 业务方法使用 context；数据库访问、任务投递、消息发布等外部依赖按需要定义小接口。
- 建议公共后端能力采用一个 Go module，各业务应用维护自己的 Go module，Web、Worker 共享应用 internal 代码；module 路径和最终目录另行确认。
- 模板、demo 与业务应用使用公共依赖，公共基础设施的修复与升级进入公共包；应用的内部包负责业务与装配。
- 单元测试可与被测代码同目录，跨服务兼容性验证集中组织。

### 4.4 demo 与应用模板来源（已确认）

首版维护一个完整 Go + MySQL demo，覆盖 Web／Worker、后台 SPA、公共系统功能、REST／GraphQL／WS／Go SSE、队列与调度，并作为应用模板来源。

demo 与模板共用维护主线，创建新项目时导出所需的应用骨架并初始化项目标识与配置。首版通过仓库内脚本导出已确认，具体流程见第 4.13 节；示例业务的取舍、模板生成后的回归以及发布依赖验收继续细化。

### 4.5 仓库级组织（已确认）

仓库采用参考项目的 packages + projects 组织方式，公共后端包与前端包分别维护，完整 demo 承担应用模板来源。下列目录与职责已确认；当前阶段继续规划，正式目录创建另行确认：

```text
/home/dream/wwwroot/go-starter/
├── packages/
│   ├── go-server-kit/              # 公共 Go module：基础能力与系统功能
│   │   └── go.mod
│   └── shadcnui-dashboard/         # 前端 npm 包：Dashboard 框架与配套客户端适配
│       └── package.json
├── projects/
│   └── multi-database-demo/              # 完整示例与应用模板来源
│       ├── go.mod
│       ├── cmd/web/
│       ├── cmd/worker/
│       ├── internal/               # 应用业务与依赖装配
│       ├── frontend/admin/         # 示例 SPA，依赖公共前端包
│       ├── migrations/             # 应用统一迁移，包含公共模块与业务表变更
│       └── deploy/                 # 应用 Docker 与运行配置
├── go.work                         # 公共 Go 包与 demo 的本地联调
├── package.json                    # 前端工作区与统一命令
├── pnpm-workspace.yaml
├── scripts/                        # 开发、生成、验收、构建、发布与模板导出
├── poc/                            # 已有五组独立验证
└── docs/
```

- 公共后端包与 demo 各自维护 go.mod；Web／Worker 共享 demo 的应用 module。
- 本地通过 Go workspace 联调公共后端包和 demo，通过前端工作区联调 npm 包与示例 SPA。Go 官方教程给出了多个 module 在 go.work 中共同开发的方式。[13]
- 发布验收建议单独验证公共依赖的实际交付产物，Go 验收使用 GOWORK=off，前端验收使用打包产物；版本发布与依赖获取方式继续细化。
- 模板导出从 demo 生成新业务项目骨架，并配置对公共 Go／npm 包的版本依赖。仓库名、仓库级目录与 Codeup 托管位置已确认；公共后端 module 路径已确认，demo module 标识及发布方式继续确认，公共框架标识见第 4.8 节。

### 4.6 仓库命名（已确认）

仓库名为 labs/go-full-stack-starter，与参考仓库 labs/astro-full-stack-starter 保持命名对应。Go 表达后端技术栈，full-stack-starter 表达公共后端包、后台前端包、完整示例及应用模板的交付定位；Echo 作为当前 Web 框架选型记录在架构与依赖中。

代码托管位置、公共框架名称及公共后端完整 Go module 路径已确认。当前本地工作目录保持 /home/dream/wwwroot/go-starter；本轮配置 origin 并更新规划文档，提交及推送继续单独确认。

### 4.7 代码托管与 module 路径（托管及远程只读访问已确认）

用户已在阿里云 Codeup 创建 shanjing/labs/go-full-stack-starter，并提供 SSH 克隆地址：

```text
git@codeup.aliyun.com:shanjing/labs/go-full-stack-starter.git
```

本地 origin 已配置为此地址；首次只读远程检查结果（权限开通前）：

- WSL 原生 SSH：返回 Permission denied (publickey)。当前 /home/dream/.ssh 仅有 known_hosts 文件，SSH_AUTH_SOCK 未设置。
- Windows OpenSSH：新仓库返回“找不到代码库，请确认是否有权限且代码库路径正确”。
- 相同 Windows OpenSSH 命令访问参考仓库 origin HEAD 成功；参考仓库代码与 Git 配置保持原状。

2026-10-03 根据用户要求，通过现有 ssh-agent 转发 socket /home/dream/.ssh/agent.sock 再次验证：

- ssh-add -l 成功读取 agent 中的 ED25519 身份。
- 通过该 agent 访问参考仓库 origin HEAD 成功。
- 新仓库仍返回“找不到代码库，请确认是否有权限且代码库路径正确”。
- 当前仓库的 core.sshCommand 已配置为 ssh -o IdentityAgent=/home/dream/.ssh/agent.sock，使后续 Git 操作使用现有 agent；配置仅作用于当前仓库。

2026-10-03 用户开通权限后，通过当前仓库配置的 ssh-agent 重试 git ls-remote origin，退出码为 0，远程未返回 refs。SSH 克隆地址及当前身份的读取权限验证成功；写入权限在后续授权推送时验证。两端 SSH 配置与参考仓库保持原状；提交与推送继续单独确认。

Go module 路径根据已确认的托管位置及 module 所在子目录细化。[14] 私有依赖获取、仓库发现、Git 鉴权与公共包发布版本进入后续实际验收。

### 4.8 公共包标识与依赖获取（公共包标识已确认，实际获取待验收）

2026-10-03 用户确认后端公共框架名称为 go-server-kit，前端 npm 包名为 @shanjing/shadcnui-dashboard。前端公共包主要定位为 Dashboard 框架；demo 的应用 module 与公共后端 module 分开维护：

| 交付项                | 标识与确认状态                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| 公共 Go 框架          | go-server-kit，目录 packages/go-server-kit，均已确认                                                       |
| 公共 Go module 路径   | codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit，已确认                   |
| Dashboard 框架 npm 包 | @shanjing/shadcnui-dashboard，目录 packages/shadcnui-dashboard，均已确认                                   |
| demo 应用 Go module   | codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo，正式 module 已创建 |

2026-10-03 以未登录 HTTP 请求探测仓库路径及当时建议的 packages/backend 路径的 ?go-get=1 页面，均返回 HTTP 200，响应中未发现 go-import 元数据。建议通过仓库路径中的 .git VCS 标识明确 Git 仓库根路径；Go 官方 module 规则支持该方式。[14] 完整依赖下载仍需在正式 go.mod 创建并发布后验收。

- 本地联调通过 go.work 组织公共 module 与 demo。
- 私有 Go 依赖配置精确范围的 GOPRIVATE，并通过 Git 的 HTTPS 到 SSH 地址映射及现有 ssh-agent 获取；后续验证采用隔离配置，当前保持全局 Git／Go 配置原状。
- 公共后端 module 位于子目录，发布标签采用实际 module 子目录路径加版本号的形式；版本号与发布时机后续确认。[14]
- npm 包名沿用团队 @shanjing scope；registry 已确认沿用团队阿里云私有 npm 仓库，见第 4.10 节；导出入口及发布方式继续细化。

2026-10-03 用户确认公共包目录与名称对应：packages/go-server-kit 和 packages/shadcnui-dashboard，仓库布局已同步更新。公共后端完整 module 路径 codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit 已获用户确认；正式工程目录与 module 已创建；发布标签在后续发布授权中创建。

### 4.9 公共包版本与发布节奏（已确认）

2026-10-03 用户确认后端 go-server-kit 与前端 @shanjing/shadcnui-dashboard 各自维护独立版本，按各自的变更与验收结果发布：

- 后端版本负责公共 Go API、系统模块与后端协议的兼容承诺。
- 前端版本负责 Dashboard 的组件、布局、路由及前端接入接口的兼容承诺。
- demo 与导出模板固定已验证的前后端依赖版本组合，并记录端到端兼容验收结果；涉及跨端协议变更时协调升级。
- 前端 registry 已确认，见第 4.10 节；首次发布版本号、发布命令及发布授权流程继续细化。

独立版本管理已确认；当前阶段仅维护规划文档，实际版本与发布操作在后续实施及授权流程中落实。

### 4.10 前端 npm 发布位置（已确认）

2026-10-03 只读核对参考项目 packages/astro-full-stack-starter/package.json，原包 @shanjing/astro-full-stack-starter 的 publishConfig.registry 为：

```text
https://packages.aliyun.com/5eb77c7538076f00011bd238/npm/npm-registry/
```

2026-10-03 用户确认 @shanjing/shadcnui-dashboard 沿用该阿里云私有 npm 仓库，继续按团队内部复用管理。发布与安装权限、独立项目依赖获取和产物验收在后续实施中验证。当前保持参考仓库、npm 配置与认证信息原状。

### 4.11 公共后端包内组织（已确认）

2026-10-03 用户确认 go-server-kit 按公共能力的职责划分三组公开子包，具体能力继续拆成各自的小包：

```text
packages/go-server-kit/
├── infra/                         # 配置、日志、数据库、Redis、Cache／Lock／Bus、队列／调度
├── transport/                     # REST、GraphQL、WebSocket、SSE 的公共协议适配
├── modules/                       # 通用账号／权限、队列／调度管理等公共功能模块
└── internal/                      # 公共框架内部实现细节
```

- infra 提供资源与基础能力，供应用和公共功能模块组合使用。
- transport 提供公共协议适配；具体业务处理逻辑集中在各功能模块或应用模块。
- modules 按功能组织 Service 及自身协议接入；公共模块维护标准模型、应用统一维护最终迁移的归属已确认；认证实现、具体标准模型及迁移验收继续专项细化。
- 应用维护 Web／Worker 入口并显式装配所需能力，业务专有代码保留在应用自身的 internal 中。

公共后端包内职责分层已确认，infra／transport 正式目录与接口已实现；modules 保留后续公共系统模块扩展位置。

### 4.12 Dashboard 与后端的接入边界（已确认）

2026-10-03 用户确认 @shanjing/shadcnui-dashboard 沿用既有 Dashboard 的可复用布局、组件与交互，将后端相关接入集中到适配接口：

- 公共 Dashboard 负责布局、导航、主题、通用组件及公共系统页面；保持既有已确认功能与交互的兼容基线。
- 公共 Dashboard 对会话状态、权限判断及系统功能数据访问定义接入接口；具体认证实现继续留在后续专项。
- demo／业务应用提供 Go API 的适配与配置，并维护自身路由、菜单配置和业务页面；公共协议客户端能力按既有前端复用职责在包内提供。
- 公共 UI 与具体后端实现之间通过适配接口衔接，接口契约与 Go API 一并进行兼容验收。

Dashboard 通过适配接口接入 Go 后端的边界已确认；会话／系统数据／退出契约、组件抽取与 demo Go 适配已实现并通过浏览器验收。公共系统页面随后续系统模块接入。

### 4.13 首版模板导出方式（已确认）

2026-10-03 用户确认首版提供仓库内的模板导出脚本，以 projects/multi-database-demo 为唯一应用源码来源，输出可独立维护的业务项目：

1. 输入目标目录、项目名称和新应用的 Go module 路径。
2. 按导出清单复制应用代码、Web／Worker 入口、后台 SPA、生成与迁移配置、开发及生产构建脚本和说明文档；应用保留完整公共系统功能及一组最小业务示例。
3. 重写应用 module 声明、应用内部导入路径、前端项目标识与配置示例；模板配置使用占位值，导出清单排除私钥、凭据、真实环境文件、本地数据、缓存、依赖目录、构建产物及源仓库 Git 历史。
4. 对公共 Go／npm 包使用已验证的固定发布版本，生成项目独立的开发与构建命令；导出产物依赖公开入口，通过包版本升级获得公共能力更新。
5. 在仓库外的隔离目录验证导出项目的依赖获取、类型检查、构建、Web／Worker 启动及关键协议流程；验收覆盖独立项目与已发布公共包的真实集成。

模板导出方式已确认；初始 Shop 示例业务已在正式 demo 落实。导出脚本、完整清单与已发布依赖版本进入模板／发布专项。

## 5. 数据库与迁移

### 5.1 现有数据库兼容

实施时优先取得现有数据库的结构快照和脱敏测试数据，并与参考源码中的模型核对：

- 表名、字段名、主键及 ID 表示方式。
- 字段类型、长度、NULL、默认值、时间精度与时区。
- 字符集、排序规则、唯一约束、复合索引和外键。
- 软删除、JSON、自定义值转换及事务行为。
- 用户、会话、账号关联、后台管理、队列执行历史等实际存在的表。

GORM 模型显式映射既有结构，历史数据读写纳入 MySQL 8.0 集成测试；需要结构调整的内容单独生成并审核迁移。

### 5.2 Atlas 社区版工作流

已确认的路线：

```text
GORM 模型
    ↓
独立 Schema 导出程序，输出目标 schema.sql
    ↓
Atlas 社区版读取 SQL，计算与历史迁移的结构差异
    ↓
生成版本化 SQL 与迁移校验文件
    ↓
人工审核 + 真实 MySQL 8.0 集成测试
    ↓
发布时使用独立迁移命令执行
```

官方 GORM Provider 支持通过 Go 程序调用 gormschema 输出 Schema SQL。[5] 当前两表 POC 已验证独立导出 SQL → Atlas 社区版生成／执行迁移的完整链路，覆盖 baseline 和增量变更；实现边界见数据库 POC 验收文档。

迁移生成使用宿主机上的专用 MySQL 开发库，业务开发库、Atlas 差异计算库和测试库按用途隔离。差异计算库属于可重建环境，凭据与目标业务库分别配置。

### 5.2.1 公共模块模型与应用迁移的归属（已确认）

2026-10-03 用户确认公共模块维护标准持久化模型及版本变更说明，应用维护最终的统一迁移历史：

- go-server-kit 的各公共功能模块提供自身标准模型和 Schema 导出接入点，并随包版本说明结构变化及所需的数据转换；公共模块的模型归公共库维护，项目扩展通过业务模型或独立关联表接入。
- 应用的 Schema 导出程序显式组合所启用公共模块的标准模型、业务模型及需要保留的额外数据库定义，产出完整目标 schema.sql；组合过程检查表名冲突及公共模型兼容要求。
- 应用依据自己已有的迁移历史，通过既定 Atlas 社区版流程生成增量 SQL，将公共表与业务表的变更一起放入应用 migrations/ 和 atlas.sum；数据回填及模型差异无法表达的变更由应用显式编写并审核。
- 每个业务项目独立维护自己的最终迁移文件、发布版本及执行记录，公共包升级进入该项目自己的审核、真实 MySQL 集成测试与发布流程。
- Web／Worker 继续按既定约定在启动时只读检查应用数据库版本，结构变更通过独立迁移命令执行。

Atlas 官方版本化工作流将目标 Schema 与应用的迁移目录分开管理，迁移文件纳入 Git 审核并按顺序执行。[15] 本项目公共模型归属与应用统一迁移历史已确认；具体标准表、数据兼容与扩展接口在后续专项落实。

### 5.3 既有数据库基线

建议接入顺序：

1. 从既有结构导出完整基线，审核纳入管理的表与对象。
2. 校核 GORM 模型导出的结构与实际结构，确认差异。
3. 生成基线迁移文件。
4. 对结构一致的既有库登记对应 baseline 版本；对空库执行基线建表 SQL。
5. 后续变更以已审核的迁移历史为基础生成。[6]

基线登记与表结构一致性核对分别执行；核对结果作为登记前置验收项。

### 5.4 社区版能力边界

Atlas 社区版采用 Apache 2.0，包含基础迁移生成、执行和状态查询能力。[7]

需要在实施中处理以下限制：

- 官方 GORM 集成示例使用 external_schema；当前社区版源码对此返回功能不支持。因此本项目采用独立导出 SQL 的路线。[5][8]
- 社区版高级迁移检查、内置迁移测试、自动 down 和托管集成功能存在发行版限制；本项目通过人工审核、普通 CI 命令和真实数据库测试完成验收。[7]
- 视图、触发器、存储过程等额外数据库对象需要先盘点，并确认社区版管理边界及人工 SQL 维护方案。[7]
- 所有工具固定版本，提前准备二进制、Go 依赖和本地开发库，验证无账号、离线运行的完整生成与执行流程。

### 5.5 迁移执行与启动校验

- 生产迁移由独立命令执行，使用专门的迁移权限。
- Web、Worker 在启动时只读检查 Atlas 迁移登记；开发产物 POC 已使用真实 MySQL SELECT-only 账户验证精确版本、失败退出与日志脱敏。实际数据库接入及 checksum／结构漂移由迁移链路继续验收。
- SQLite 测试使用隔离数据库，按模型自动建表并在结束后清理。
- MySQL 测试通过实际迁移建库，并使用固定补丁版本覆盖约束、方言与事务行为。

### 5.6 数据库 POC 实施与验收

验收文档：[数据库兼容性 POC](/home/dream/wwwroot/go-starter/poc/database/README.md)。

- 独立 POC module 已实施 GORM 模型、Gen 查询、MySQL／SQLite Schema 导出、Atlas 社区版迁移和测试脚本。
- SQLite 基础测试、真实 MySQL 8.0.46 集成、空库基线、既有库 baseline、漂移检测、增量变更、checksum 故障和产物确定性共 29 项检查通过。
- UTC 和 Asia/Shanghai 时间配置、MySQL 默认时间与自动更新、NULL、唯一约束和复合索引顺序均有测试覆盖。
- 工具版本和下载校验固定；依赖缓存准备后，在零第三方账号和关闭 Go 获取／失效外网代理条件下验收通过。系统级断网验证待补充。
- 当前夹具覆盖参考源码的两张表，真实业务库快照及完整历史数据验收待补充。正式迁移还需校验默认 InnoDB 引擎与时区配置，并将方言补充逻辑扩展到完整表清单。
- POC 固定版本见验收文档与工具锁定文件；Web／Worker 启动版本检查已有开发产物 POC 验收。正式 module、运行时依赖布局及完整真实库接入留在后续工程实施阶段。

### 5.7 MySQL 8.0 生命周期风险

MySQL 官方说明：8.0 随 2026 年 4 月的 8.0.46 进入 EOL；支持公告列出的 Oracle Sustaining Support 起始日期为 2026-04-21。[9]

本次继续保留用户确认的 MySQL 8.0 兼容目标，数据库升级作为独立后续事项；兼容性验收固定实际使用的补丁版本。

## 6. Redis、队列和定时任务

### 6.1 Redis 使用边界

- go-redis 为 Cache、Lock、Bus 提供底层客户端能力。
- Asynq 使用其队列运行机制，与基础设施统一 Redis 连接配置；各组件的连接池生命周期分别管理。
- 建议各模块设置独立命名空间，并校核所选 Asynq 版本支持的队列隔离方式。
- 分布式锁需验证持有者标识、原子释放、租约过期、续租及业务幂等行为。
- 首版 Redis 按非 Cluster 部署验证；具体版本、单实例／高可用配置另行确定。

### 6.2 队列

- Web 或业务模块构造并投递任务；Worker 调用共享 Service 完成执行。
- 并发数、重试策略、超时与队列优先级通过统一配置管理。
- Asynq 为至少执行一次语义，任务处理使用业务幂等键等机制保护副作用。[3]
- 既有 BullMQ 待执行任务的接续处理移出首版范围；现有数据库中的执行记录按数据兼容目标处理。
- 现有后台的队列查询和管理接口需要逐项映射，特别核对状态枚举、执行记录、失败信息和管理操作。
- Asynq 当前为 v0 系列，公共 API 的版本变化需通过固定版本与回归测试管理。[3]

### 6.3 定时任务

- 任务、cron 表达式、时区和载荷构造在 Go 代码中定义。
- 随 Worker 启动加载，调度由 Worker 承担。
- 后台提供状态查看、启停、手动触发；cron 定义随版本发布。
- 多实例共享启停状态，通过调度权协调、唯一调度标识和任务幂等共同控制重复触发。
- Leader 切换、租约失效、重启时的调度行为和时区边界进入 POC 验收。
- 启停状态通过 Redis 共享并随持久化恢复；POC 已验证初始化保留状态及 Worker／Redis 重启恢复。正式操作权限、审计、停用在途语义和持久化／备份策略继续细化。

### 6.4 Worker POC 实施与验收

验收文档：[Worker 队列与调度 POC](/home/dream/wwwroot/go-starter/poc/worker/README.md)。

- 固定 Asynq v0.26.0、robfig/cron v3.0.1 与宿主机测试 Redis 7.0.15；Asynq 依赖要求 Worker POC 使用 go-redis v9.14.1，正式单 module 接入时统一 Redis 客户端版本并回归实时链路。
- 两个独立 Worker OS 进程共享物理队列，实际消费分配、并发上限、优先级、部署消费隔离、延迟、重试上限、归档、手动重试、context 超时和取消均已验证。
- Redis Lua 原子幂等副作用覆盖不同任务 ID 的重复执行与提交后 Worker SIGKILL，自然等待 Asynq 的真实 task lease／recoverer 后确认重试和副作用计数。
- 随机 token 原子续租／释放、Leader 崩溃租约接管、相同时槽唯一入队、共享启停、手动请求去重、双 Worker 重启状态恢复和 cron／DST 边界已验证。`@every` 按 UTC epoch 锚定周期，当前时槽派发与停机空档采用明确的 POC 策略。
- Redis AOF 启用后，真实 SIGTERM／重启验证 pending／scheduled 任务、队列暂停和调度停用状态恢复。Worker SIGTERM 验证短任务完成与等待超时后的取消／重新入队。
- 共 21 项流程检查、34 次叶级测试执行通过；验收使用固定依赖离线环境，保持参考仓库源码／Git 状态，回收自身测试进程。
- 当前投递入口为共享 Go 函数，副作用与幂等记录位于隔离 Redis。正式 Web 投递路由、MySQL 事务幂等／长期执行历史、后台 GraphQL 兼容、权限审计及 outbox 继续接入。Asynq 每 Worker 总并发与现有队列级配置需要明确映射。
- Redis HA／网络分区／TLS、停机补跑、严格优先级饥饿、生产规模与 race detector 留到相关专项。生产 Redis 版本和持久化策略独立确认。

## 7. 实时通信与多实例

### 7.1 协议兼容

- REST：路径、方法、参数、响应结构、状态码和错误行为。
- GraphQL：端点、Schema、查询／变更、标量序列化、null 语义和错误格式。
- WebSocket：路径、消息格式、订阅、取消订阅、请求／回包关联及终止行为。
- SSE：采用 Go 原生实现与新事件约定，验收逐条刷新、心跳、结束条件、超时、错误与客户端取消；客户端按 Go 流协议适配。
- 后台 SPA：通过既有接口完成登录、业务查询、队列管理和实时示例。

REST／GraphQL／WebSocket／Bus 以现有源码与完整客户端交互建立测试样本；SSE 依据 Go 流协议建立独立测试。功能按协议逐项验收。

### 7.2 多实例设计约束

- Web 维护本实例连接，通过 Redis Bus 完成跨实例广播与查询回包。
- 发布请求前确认结果订阅就绪，使用关联标识处理乱序回包和超时。
- 请求成功、失败、超时、取消和连接断开均触发订阅与上下文清理。
- 登录和共享业务状态需要让所有 Web 副本访问，具体会话方案在认证设计中确定。
- 多个 Worker 共享队列，业务副作用满足幂等要求。
- Redis Pub/Sub 为至多一次投递，断线期间的消息可能丢失；发布返回的订阅数与客户端最终送达数分别定义。[10]
- 消息恢复、gap、背压和重连后的状态刷新按现有行为建立验收样本；需要持久化补发的业务另行明确范围。

## 8. 配置与日志

### 8.1 配置

- 配置以环境变量为主，本地通过 .env 加载，生产由运行环境注入。
- Web、Worker 共用类型化配置定义，按入口校验各自必需的配置。
- 校验地址、必填密钥、超时、并发数、数据库用途和环境标识等。
- 明确连接配置的优先级、环境隔离和敏感字段过滤。
- .env 加载库、具体变量名和默认值在实施前确定，并评估现有配置名兼容要求。

### 8.2 日志

- 使用 slog，开发文本输出，生产 JSON 输出到标准输出／标准错误，由运行环境收集。
- Web 携带 request_id，Worker 携带 task_id；统一记录服务名、实例标识、耗时和错误。
- 密码、验证码、Token、数据库凭据及其他敏感载荷通过过滤或脱敏处理。
- 错误追踪、指标和告警接入独立评估，现有相关能力纳入功能盘点。

## 9. 开发、生成与发布流程

### 9.1 本地开发

全部组件在宿主机运行：

1. 提前启动本机 MySQL 8.0 和 Redis。
2. 准备 .env 及开发、迁移差异计算、测试用途的隔离数据库。
3. 统一开发命令启动后台 SPA 开发服务器、Web Air 和 Worker Air。
4. SPA 请求代理到 Go Web；代理中的 WebSocket、SSE 和认证上下文一并验证。
5. Web、Worker 使用独立 Air 配置和编译产物；共享源码变化触发相应服务重启。
6. 主进程退出时统一清理子进程，避免遗留进程和端口占用。

SQLite 作为默认自动化测试数据库；MySQL 集成测试连接本机专用测试库，CI 使用真实 MySQL 8.0 环境。

[开发与产物 POC](/home/dream/wwwroot/go-starter/poc/delivery/README.md) 已验证宿主机统一监管、双 Air 重载、React 热更新，以及 Vite 代理下 REST／双 GraphQL／WebSocket／Go SSE 的运行链路。源码副本验收覆盖 SIGTERM、Ctrl-C 和三个监管子进程异常退出；当前监管实现面向 Linux／WSL。

### 9.2 建议统一命令能力

正式工程已提供 setup／generate／schema／schema:diff／migrate／dev／test／check／build／verify 统一命令，实际用法见仓库 README。原 POC 保留以下可复现入口：

```bash
# 宿主机启动 SPA、Web、Worker；先按 POC 文档准备环境变量与已迁移数据库
rtk proxy python3 /home/dream/wwwroot/go-starter/scripts/dev-delivery-poc.py
# 构建内嵌 SPA 的 Web 与独立 Worker
rtk proxy python3 /home/dream/wwwroot/go-starter/scripts/build-delivery-poc.py
# 自动创建隔离宿主机 MySQL／Redis，验收开发与产物链路
rtk proxy python3 /home/dream/wwwroot/go-starter/scripts/verify-delivery-poc.py
# 独立容器验收；当前宿主机容器环境阻塞
rtk proxy python3 /home/dream/wwwroot/go-starter/scripts/verify-delivery-docker.py
```

正式工程已提供的统一能力与后续生产交付目标：

| 能力     | 预期行为                                               |
| -------- | ------------------------------------------------------ |
| 开发     | 启动 SPA、Web、Worker，管理进程退出。                  |
| 代码生成 | 生成 gqlgen 和 GORM Gen 代码，并检查生成结果一致性。   |
| 迁移生成 | 导出 Schema SQL，调用 Atlas 社区版生成差异和校验文件。 |
| 迁移执行 | 对明确指定的目标库独立执行迁移，提供执行结果。         |
| 测试     | 默认运行 SQLite 测试，显式启用 MySQL／Redis 集成验证。 |
| 构建     | 先构建 SPA，再编译 Web 和 Worker。                     |
| 镜像构建 | 输出包含两个二进制的同一版本 Docker 镜像。             |

### 9.3 生产构建与运行

```text
前端依赖和 SPA 构建
    ↓
生成 Go 类型化代码，检查生成结果
    ↓
构建 Web：内嵌 SPA
构建 Worker：独立二进制
    ↓
Docker 运行镜像：包含 Web 和 Worker
    ├── Web 容器：运行 Web 二进制
    └── Worker 容器：运行 Worker 二进制
```

- 两类容器独立配置环境变量、资源和副本数量。
- 后台 SPA 更新需要重新构建并发布包含该产物的 Web 镜像版本。
- 迁移通过独立发布步骤执行，迁移工具与产物的打包形式待确定。
- 开发产物 POC 已生成静态链接的两个入口，Dockerfile 已准备非 root scratch 镜像、CA 证书和内嵌时区数据；镜像构建、基础镜像标签／摘要与容器运行仍待真实 engine 验收。
- 生产编排工具、数据库与 Redis 的托管方式、反向代理与 TLS 接入方式待确认。

## 10. 测试与兼容性验收

| 层级            | 环境与内容                                               | 验收目标                                               |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| 单元测试        | 业务模块、小接口替身                                     | 业务规则、错误转换、取消与超时行为。                   |
| 默认数据库测试  | 隔离 SQLite                                              | 自动建表、查询和事务的基础行为，运行后清理。           |
| 生产数据库集成  | 固定补丁 MySQL 8.0                                       | 迁移、类型、排序规则、约束、索引、事务及既有数据读写。 |
| Redis／队列集成 | 隔离 Redis 命名空间                                      | TTL、锁、任务重试、崩溃恢复与幂等。                    |
| 协议与流传输    | 现有 REST／GraphQL／WebSocket／Bus 样本、Go SSE 独立样本 | 既有协议兼容，Go SSE 验收刷新、取消、心跳与有界写入。  |
| 多实例验证      | 至少两个 Web、两个 Worker                                | 跨实例查询／广播、任务消费、调度协调与故障清理。       |
| 前端端到端      | 现有后台与实时示例                                       | 完整发送、订阅、服务端处理、客户端收取与清理链路。     |
| 生产产物验证    | Docker 镜像内两个角色                                    | SPA 托管、环境注入、启动校验、健康状态和退出行为。     |

验证约定：

- SQLite 用于快速本地反馈，MySQL 8.0 用于生产数据库兼容验收。
- 测试按用途隔离端口、Redis 数据和数据库，防止跨用例污染。
- 迁移验收覆盖空库创建、既有库 baseline、后续增量变更与重复执行。
- 报告分别列出静态分析、自动化测试、人工验收和生产环境验证状态。

## 11. 待定事项与下一阶段

### 11.1 待细化事项

- Redis 等正式工程固定版本；Go／Echo v5／gqlgen／GORM／Gen／驱动已固定版本并通过正式工程验收；生产 Redis 版本与高可用配置继续确认。
- 公共包／demo 的仓库级组织、职责归属、仓库名及 Codeup 托管位置已确认；正式 module、infra／transport 接口、Dashboard 布局与产物及统一命令已实现。公共账号四表与邮箱认证已实现；完整旧库迁移、远程依赖获取与发布流程继续专项验收。公共框架名称、目录及公共后端 module 路径已确认，见第 4.8 节。ssh-agent 远程只读访问已通过；用户已手动推送首次提交，自动化写入权限与依赖发布继续在后续授权流程中验证。
- 实际数据库快照、迁移范围及额外数据库对象；只读版本门禁已有 POC，完整真实库接入和人工 resolved 记录的运维策略继续细化。
- Go 邮箱认证与核心会话已实现；完整权限、用户／会话管理、真实旧库快照与生产会话切换继续验收。
- 定时任务共享启停与调度协调已有 POC；正式权限审计、持久化／备份与停机补跑策略继续细化。
- 队列后台协议映射、消息断线恢复及背压行为。
- Redis 版本与高可用配置、生产编排、反向代理、TLS 和观测能力。

本阶段已实现邮箱密码登录、退出与 Cookie／Bearer 会话，公共 auth 模块保留 Better Auth 固定版本散列与四表契约，并用数据库单例锁保护首位 owner 初始化。完整权限进入 R2，生产切换依照兼容矩阵验收。手机号登录、短信验证码、手机号绑定及相关新增字段移至后续阶段。

### 11.2 兼容性 POC 进度

数据库、Web、实时、Worker 和开发产物共五组独立 POC 已实施；宿主机局部验收已通过，开发产物的容器部分处于环境阻塞状态。正式工程整合已实施并完成宿主机验收，见第 11.3 节；以下保留独立 POC 的原始验证范围：

1. **数据库链路（两表样例已通过）**：GORM 模型 → Gen → Schema SQL → Atlas 社区版；SQLite、MySQL 8.0、baseline、索引、约束、默认值和种子历史数据已验证。完整真实库接入待补充。
2. **Web 接入（协议子集已通过）**：Echo v5.4.0 + gqlgen v0.17.95；38 项现有处理器捕获样本、REST／双 GraphQL 共享 Service、上下文隔离、重生成及真实 HTTP 启停已验证。完整业务 Schema、过滤语义、认证与数据库业务整合待补充。
3. **实时与多实例（局部验收已通过）**：两个真实 Web 进程、45 项 WS／Bus 参考样本、Go 原生 SSE、跨实例请求回包、订阅就绪、取消、超时、慢客户端、Redis 停机／恢复、Web 崩溃 TTL 与活动流退出；14 项流程检查、82 次叶级测试执行。认证、共享订阅桥接、gap／resync、旧客户端端到端与生产代理拓扑待补充。
4. **队列与调度（局部验收已通过）**：两个独立 Worker 进程、Asynq 消费／并发／优先级／重试／超时、原子副作用幂等、真实 SIGKILL 自然恢复、Leader 租约接管、共享启停／手动触发／重启状态、Redis AOF 恢复与 SIGTERM 超时重新入队；21 项流程检查、34 次叶级测试执行。MySQL 事务幂等／执行历史、正式 Web 投递与后台协议、权限审计及生产可靠性待补充。
5. **开发与产物（宿主机验收已通过，容器环境阻塞）**：25 项流程检查、152 次叶级 Go 测试；统一启动／退出、双 Air 重载、React 热更新、SPA 内嵌、只读迁移门禁与故障启动、Web 活动流清理和 Worker 短任务退出已验证。统一依赖图下 Web／实时协议回归及独立 Web／实时／Worker 回归通过。同镜像两个角色的 Dockerfile 与隔离验收脚本已准备，构建、运行、基础镜像摘要及容器退出待 Docker engine 验收；race detector 待具备 C 编译器的环境。

各阶段证据见 [数据库 POC 文档](/home/dream/wwwroot/go-starter/poc/database/README.md)、[Web POC 文档](/home/dream/wwwroot/go-starter/poc/web/README.md)、[实时 POC 文档](/home/dream/wwwroot/go-starter/poc/realtime/README.md)、[Worker POC 文档](/home/dream/wwwroot/go-starter/poc/worker/README.md) 和 [开发产物 POC 文档](/home/dream/wwwroot/go-starter/poc/delivery/README.md)。五个独立 module 完成宿主机局部验证；实时 module 通过本地 replace 复用 Web，delivery module 复用 Web／实时／Worker。正式工程目录、统一依赖与命令已落实；后续补齐容器验收，并按既有行为逐模块替换业务与认证能力。

Web 协议样本来自完整参考 SDL 与现有 Yoga／健康处理器，业务 Resolver 使用确定性替身。成功、业务错误及 DateTime 严格比较；解析／校验错误比较状态、信封与 code，移除原始异常细节。Header／Cookie 探针仅验证 context 传递；认证进入后续专项，实时流的 Go POC 已独立验收。

### 11.3 第一阶段正式工程整合（已完成宿主机验收）

仓库布局、公共包标识、独立版本、前端发布位置、公共后端分层、Dashboard 接入边界、模板导出方式及模型／迁移归属已确认。第一阶段已将独立 POC 收敛为正式可运行工程：

1. **正式工作区**：创建 packages/go-server-kit、packages/shadcnui-dashboard 和 projects/multi-database-demo，建立真实 Go module、go.work 与 pnpm workspace，并统一依赖及工具版本。
2. **后端与 demo**：将已验证的基础设施及协议能力整理到公共包；demo 显式装配 Web／Worker，维护最小业务示例、模型、Gen 及统一应用迁移，保留既有接口和消息契约的兼容验收。
3. **Dashboard 接入**：从现有 Dashboard 提取复用壳层与组件，建立应用适配接口并接入 demo；现有界面与交互作为兼容基线，账号／权限具体实现后续专项接入。
4. **开发与验证**：统一宿主机开发、生成、迁移、测试及构建命令，保持生产 Docker 交付配置；运行正式工程回归并记录容器、race detector 及环境待验证项。

本阶段已完成真实公共包与 demo 的开发、构建及运行闭环。公共系统模块专项、模板导出实现、正式包发布与独立项目的发布依赖验收继续按后续阶段落实。本阶段实现保持未提交；任务创建、提交、推送和发布继续按各自授权推进。

2026-10-03 正式工程 `pnpm verify` 完整验收通过：16 项流程检查、193 条 Go 测试通过记录（含父／子用例）、2 项 Dashboard 单测、内嵌 SPA 与宿主机开发各 3 项浏览器测试，以及公共 Dashboard HMR 整页刷新检查。正式 MySQL／SQLite 迁移、受限账户、双 Web／Worker、独立故障场景、公共 Go 双角色重建与统一退出均通过。Docker、race detector、认证／授权、真实旧库和远程包发布按证据边界进入后续专项。

执行口径、固定日志目录与 Schema checklist 见 [第一阶段验收记录](/home/dream/wwwroot/go-starter/docs/phase-one-verification.md)。

## 12. 官方参考

以下资料用于确认组件能力、发行版限制及 Go 包组织约定，查阅日期为 2026-10-02 至 2026-10-03；本项目组合验证状态见第 10、11 节。

1. [gqlgen 官方介绍](https://gqlgen.com/)：Schema 驱动与类型生成。
2. [GORM Gen 官方指南](https://gorm.io/gen/)：由 Go struct 生成类型化查询。
3. [Asynq 官方 README](https://github.com/hibiken/asynq)：任务语义、定时任务、版本与 Redis Cluster 限制。
4. [Go embed 官方文档](https://pkg.go.dev/embed)：编译时嵌入资源。
5. [Atlas GORM Provider 官方说明](https://github.com/ariga/atlas-provider-gorm/blob/master/README.md)：Go 程序导出 Schema SQL。
6. [Atlas 既有数据库接入指南](https://atlasgo.io/versioned/import)：baseline 与空库建表。
7. [Atlas 社区版说明](https://atlasgo.io/community-edition)：许可与能力边界。
8. [Atlas 社区版配置扩展源码](https://github.com/ariga/atlas/blob/master/cmd/atlas/internal/cmdext/cmdext.go)：SchemaExternal 功能边界。
9. [MySQL 8.0 发布说明](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/)和 [MySQL 支持公告](https://www.mysql.com/support/eol-notice.html)：生命周期。
10. [Redis Pub/Sub 官方文档](https://redis.io/docs/latest/develop/pubsub/)：消息投递语义。
11. [Go net/http ResponseController 官方文档](https://pkg.go.dev/net/http#ResponseController)：SSE 刷新与单次写入期限。
12. [Go 官方 module 布局指南](https://go.dev/doc/modules/layout)：公共包、internal 与应用入口的组织边界。
13. [Go 官方 workspace 教程](https://go.dev/doc/tutorial/workspaces)：多 module 本地联调与发布后的版本依赖。
14. [Go 官方 modules 参考](https://go.dev/ref/mod)：module 路径、仓库子目录、仓库发现及私有依赖配置。

15. [Atlas 官方项目组织指南](https://atlasgo.io/guides/evaluation/project-structure)：目标 Schema、应用迁移目录与版本化 SQL 审核流程。

## R0／R1 迁移进展

公共 auth 模块与四张兼容账号表已接入，应用通过新的 `202610040001` 迁移组合认证模型；邮箱密码、Cookie／Bearer 会话、封禁检查、数据库互斥初始化和真实后台登录／退出已实现。手机号相关能力保留延期范围。完整权限／用户管理按 R2 推进，Shop／Product／Order 对齐按 R3 推进。

兼容策略见 `/home/dream/wwwroot/go-starter/docs/migration-compatibility-matrix.md`，本地验证与生产待验收边界见 `/home/dream/wwwroot/go-starter/docs/auth-migration-verification.md`。前文 POC 与首阶段记录继续保留各自的历史证据边界。
