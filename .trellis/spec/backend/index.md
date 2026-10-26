# 示例 Go 后端

用于应用组合、业务、GraphQL、Web/Worker 或数据库变化。源码路径均相对工作区根目录。

- [目录边界](directory-structure.md)
- [数据库与迁移](database-guidelines.md)
- [GraphQL 契约](graphql-guidelines.md)
- [错误与日志](error-handling.md)
- [质量与测试](quality-guidelines.md)

开发前读受影响源码、同目录测试、配置和 SDL；收尾核对接口/生成物/spec 一致，并记录实际命令结果。

## API URI 规范

新增或调整 API 时，按协议统一 URI 前缀，便于路由注册、客户端调用和代理配置保持一致。

| 协议      | URI 形式                  | 现有示例                                                   |
| --------- | ------------------------- | ---------------------------------------------------------- |
| REST      | `/api/rest/*`             | `/api/rest/demo/shops/:id`、`/api/rest/internal/health`    |
| GraphQL   | `/api/graphql/endpoint`   | `/api/graphql/admin`、`/api/graphql/member`                |
| WebSocket | `/api/websocket/endpoint` | `/api/websocket/bus-query`、`/api/websocket/bus-broadcast` |

- `*` 为具体资源或业务路径；`endpoint` 为端点名称占位符，实际 URI 使用具体名称。
- REST 资源路径放在 `/api/rest/` 下；GraphQL 操作由对应端点的 Schema 定义；WebSocket 使用对应端点建立连接。
- 例如店铺 REST 使用 `/api/rest/demo/shops/:id`，不能直接注册为 `/api/shops/:id`；GraphQL Admin 使用 `/api/graphql/admin`，不能简写为 `/graphql/admin`。
- 变更 URI 时同步后端路由、前端与小程序请求、开发和部署代理、测试与文档。回归断言对应 REST 请求、GraphQL 操作或 WebSocket 握手到达预期处理器，并保持已有鉴权与错误契约。
- 代码依据：应用目录下的 `backend/internal/web/server.go` 与 `backend/internal/realtime/runtime.go`；Go 路由回归沿用对应包内 `*_test.go`。

## 内部健康探针

### 适用范围

正式应用的存活与就绪接口统一归入 REST；旧 `/health/live`、`/health/ready` 停止注册。历史 `poc/delivery` 保持自己的隔离接口。

### 接口

| 方法与 URI                            | 响应                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/rest/internal/health`       | `200`，纯文本 `ok\n`；另支持无正文的 `HEAD`                                           |
| `GET /api/rest/internal/health/live`  | `200`，JSON `{"status":"alive"}`                                                      |
| `GET /api/rest/internal/health/ready` | `200`，JSON `{"status":"ready"}`；依赖异常返回 `503`，JSON `{"status":"unavailable"}` |

### 请求与依赖契约

应用最外层 HTTP Handler 通过 `web.WithHealth` 精确承接三个探针路径，复用公共 `httpx.New` 的请求标识、恢复和错误处理；探针允许匿名访问，不进入业务 Guard、来源校验或会话数据库。其他路径继续交给原有业务 Handler。存活检查只表示进程存活；就绪检查在一秒上下文期限内核验数据库迁移版本与 Redis。探针不接收业务载荷，不新增环境变量。

### 校验与错误矩阵

新路径由各自处理器返回上述状态；相邻的 `/api/rest/internal/health/details`、`/api/rest/internal/health/live/details` 等已注册业务路由仍执行认证，匿名返回 `401`。不得按整个健康路径前缀放行。

### 正常、基线与拒绝场景

正常：匿名请求就绪探针得到依赖检查结果。基线：原有轻量健康检查保持响应。拒绝：伪装成探针子路径的业务接口不能绕过认证；携带过期凭据的真实探针仍可执行健康检查。

### 验证要求

应用 `internal/web/health_test.go` 在工作区和 `GOWORK=off` 固定 kit 模式分别覆盖匿名、无效 token、会话数据库关闭、就绪超时及相邻路径认证；公共 auth 包内的健康路径测试保留公共 Guard 契约。正式宿主与 Docker 验收脚本使用新就绪地址，Docker 故障专项同时断言依赖异常下存活为 `200`、就绪为 `503`。工作区源码联调与独立应用的固定 kit 版本验收分别记录，正式发布、升级版本另行执行。

### 错误与正确写法

错误：继续调用 `/health/ready`，或使用 `HasPrefix(path, "/api/rest/internal/health")` 放行认证。正确：调用 `/api/rest/internal/health/ready`，应用边界只匹配表中三个完整路径，其他请求进入业务认证链路。

## 开发工具来源

应用 package.json 直接调用 scripts/\*.py，生成、开发监管、格式与清理实现随源码交付。应用使用自己的 .tools/.runtime 与默认 GOWORK=off；固定 Go kit 和 Dashboard 依赖保持 release-dependencies.json 校验。发布凭证绑定应用提交、kit 原来源和完整交付摘要，独立 demo 同步消费该凭证。

## 前后端环境配置

app-layout-v2 的后端默认配置为 `backend/.env`，模板为 `backend/.env.example`；前端配置和模板位于 `frontend`。`--env-file` 与 `STARTER_ENV_FILE` 只指定后端配置；主仓共享 `.env`、所选后端文件、进程环境依次覆盖，独立 app-layout-v2 读取所选后端文件后由进程环境覆盖。app-only-v1 保持根 `.env`，选择自定义文件时仍按根 `.env`、所选文件、进程环境依次覆盖。

布局规范名为 `app-layout-v2`，其中 `v2` 表示目录契约代际；`app-only-v2` 为兼容别名，两者使用相同目录与环境规则；`app-only-v1` 保持历史根目录布局。应用脚本负责布局解析与路径适配。

主仓应用入口使用 multi-database-demo 名称前缀，应用直接运行本地 scripts 命令；前端构建、Codegen、类型检查和测试使用 `frontend_environment` 筛选后的宿主工具环境与公开配置，后端密钥保持隔离。Vite 自行加载公开 `.env*`，保留 mode/进程优先级；启动器通过应用安装的 Vite `loadEnv` 按 development 模式读取 `SPA_PORT`，支持行尾注释、`export`、多行值和变量展开；加载子进程保持同一环境筛选规则，仅返回 `SPA_PORT` 与 `WEB_ORIGIN`，将后端 `WEB_ADDR` 派生的 `WEB_ORIGIN` 注入 Vite，前端代理地址由后端监听配置保持一致。Docker 前端继续使用公开 build args，后端使用运行时环境。应用脚本及主仓公共脚本、formatter 白名单随同一固定提交交付。

## Bus 公开演示页

- `/test/bus` 的 GET/HEAD 由 `internal/web/pages.go` 注册，模板与默认数据由 `internal/pages` 提供。正文公开可读，HEAD 保持空正文并跳过会话 I/O；匿名、过期和封禁会话呈现禁用操作及登录链接，会话基础设施错误返回脱敏 503。
- 操作资格与现有实时 API 的有效登录会话要求一致；REST/WebSocket 继续由认证 Guard 校验会话与来源，页面读取沿用 AuthenticatePage。登录回跳固定允许 `/test/bus` 和 `/test/queue`。
- 复用 Redis Bus 与既有四个实时入口；SSE 事件保持 `ready/result/error/done`，WebSocket 使用 `type/payload/sentAt` 信封。后端查询窗口保持 5 秒。
- 前端通过 `public.ts` 挂载局部增强；Vite 显式代理 `/test/bus`，Tailwind 扫描 Go 模板。SSR/会话测试沿用 pages、web 同目录测试；真实浏览器链路位于 `frontend/tests/bus.spec.ts`，需要隔离 Redis、已迁移数据库与合成登录账号。

- Bus SSR 模板沿用 Astro 参考页的标题层级、下划线 Tab、广播单行输入与 device/request 双列工作台，设备／查询记录嵌入对应卡片，保留登录 fieldset 门禁及无 JavaScript 两套说明。正文接口和 SSE 事件名以 Go 实现为准；结构由 `internal/pages/pages_test.go` 回归。

## 静态资源环境缓存策略

- Web 启动时将已校验的 `config.Config.Development` 传入 `web.Handler`；应用托管层对开发环境的 `/admin`、`/admin/*` 和 `/public/*` 响应统一设置 `Cache-Control: no-store`，涵盖 GET/HEAD、深链入口、重定向、错误及范围请求。
- 缓存头在提交状态码或正文时覆盖；纯 HEAD 深链在处理结束时提交响应头。生产环境沿用公共 SPA Handler：`assets/*` 使用 `public, max-age=31536000, immutable`，入口 HTML、固定文件名资源与主题脚本使用 `no-cache`。
- `/api/*`、WebSocket、SSE 及其他业务路径继续使用原始 ResponseWriter 和原缓存策略；公共 Go kit API 与固定依赖版本保持原值。
- 回归入口为 `backend/internal/web/static_cache_test.go`，断言实际提交的响应头、生产策略、GET/HEAD、206/304 和 API writer 隔离。已有浏览器强缓存需要一次清理或强制重新加载；开发资源重建／Vite HMR 属于独立更新链路，本策略只控制响应缓存。

## 应用命令归属

开发监管源码由本应用 scripts 维护，公共支持脚本与 formatter 在根 scripts、tools/cmd/format-go 单点维护；工作区通过 shared_scripts.py 复用，独立导出展开完整本地源码。package.json 直接组合应用命令，Go kit、Dashboard 继续固定依赖，应用 .tools/.runtime 与默认 GOWORK=off 保持独立。派生项目直接修改自己的命令与脚本，升级采用定向补丁和代码审查。

公共支持脚本与 formatter 在主仓单点维护，工作区通过 scripts/shared_scripts.py 复用根实现；独立导出展开完整本地脚本并交付白名单 tools 源码和同目录单测。派生项目直接修改本地实现，命令保持应用自己的默认 GOWORK=off 与 .tools/.runtime；应用开发监管源码在应用 scripts 自持。

开发重载由 scripts/dev_reload.py 执行，backend 保留 gqlgen 配置；历史 Air 配置已清理。公共工具优先选择应用自带的 tools/go.mod，工作区薄入口显式传递共享来源；完整独立脚本保持本地来源，STARTER_TOOL_ROOT 支持显式覆盖。

## 显式本地 kit 联调与发布验收

本地 STARTER_KIT_SOURCE 优先于应用根 .starter.local.json 的 kitSource；相对路径以应用根解析，必须是正确的 kit Go 模块，无效路径立即失败。setup、dev、generate、schema、check、test、coverage 和 build 共用选择，受控 workspace 与代际外部 kit 快照仅位于 .runtime，不改正式 go.mod/go.sum，也不改变 Dashboard 来源。取消本地配置恢复默认。

正式 CI 设置 STARTER_KIT_MODE=installed、GOWORK=off，忽略本地配置并拒绝显式源码覆盖；必须从候选模块 zip 安装并核对版本、sum/goModSum、缓存目录及无 Replace。一次冻结最终应用后执行 setup/generate/check/test/test:go:coverage/build，生成后交付内容变化即失败。成功凭证与正式 kit 核对均匹配才可发布同一快照；失败续跑复用有效凭证，不再导出或验收。.starter.local.json、外部源码和候选状态不随应用交付。

## Go 依赖等待期

第三方 Go 包、工具与新增／升级的传递依赖均发布满 7 天后采用，以官方模块代理的精确版本 `.info` 时间核对；`go mod tidy` 后复核最终选择，不使用分支名或跳过间接依赖。Go 工具链与固定下载工具遵循同一等待期，平台 URL 与 SHA256 同步维护；自维护公共包沿用候选与正式发布验收契约。
