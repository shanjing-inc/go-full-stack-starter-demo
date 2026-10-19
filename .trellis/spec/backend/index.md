# 示例 Go 后端

用于应用组合、业务、GraphQL、Web/Worker 或数据库变化。源码路径均相对工作区根目录。

- [目录边界](directory-structure.md)
- [数据库与迁移](database-guidelines.md)
- [GraphQL 契约](graphql-guidelines.md)
- [错误与日志](error-handling.md)
- [质量与测试](quality-guidelines.md)

开发前读受影响源码、同目录测试、配置和 SDL；收尾核对接口/生成物/spec 一致，并记录实际命令结果。

## 开发工具来源

应用 package.json 直接调用 scripts/\*.py，生成、开发监管、格式与清理实现随源码交付。应用使用自己的 .tools/.runtime 与 GOWORK=off；固定 Go kit 和 Dashboard 依赖保持 release-dependencies.json 校验。发布验收凭证绑定同一 sourceCommit/sourceTree，独立 demo 同步消费该凭证。

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

开发监管源码由本应用 scripts 维护，公共支持脚本与 formatter 在根 scripts、tools/cmd/format-go 单点维护；工作区通过 shared_scripts.py 复用，独立导出展开完整本地源码。package.json 直接组合应用命令，Go kit、Dashboard 继续固定依赖，应用 .tools/.runtime 与 GOWORK=off 保持独立。派生项目直接修改自己的命令与脚本，升级采用定向补丁和代码审查。

公共支持脚本与 formatter 在主仓单点维护，工作区通过 scripts/shared_scripts.py 复用根实现；独立导出展开完整本地脚本并交付白名单 tools 源码和同目录单测。派生项目直接修改本地实现，命令保持应用自己的 GOWORK=off 与 .tools/.runtime；应用开发监管源码在应用 scripts 自持。

开发重载由 scripts/dev_reload.py 执行，backend 保留 gqlgen 配置；历史 Air 配置已清理。公共工具优先选择应用自带的 tools/go.mod，工作区薄入口显式传递共享来源；完整独立脚本保持本地来源，STARTER_TOOL_ROOT 支持显式覆盖。
