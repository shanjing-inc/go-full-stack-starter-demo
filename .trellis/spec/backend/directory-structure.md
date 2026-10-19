# 应用目录

| 入口                                                                     | 职责                          |
| ------------------------------------------------------------------------ | ----------------------------- |
| backend/cmd/web、backend/cmd/worker                                      | 组装、启动、退出              |
| backend/internal/config                                                  | 环境解析、脱敏                |
| backend/internal/model、backend/internal/service                         | 模型、业务、事务              |
| backend/internal/graph/{member,admin,model,scalar}                       | Schema/resolver/DTO/标量      |
| share/schema、backend/gqlgen-\*.yml、backend/cmd/gen、backend/cmd/schema | 生成源与目标 Schema           |
| backend/internal/query、backend/migrations                               | 生成查询与版本迁移            |
| backend/internal/{realtime,protocol,tasks,pages}                         | 实时、队列、SSR               |
| frontend、backend/internal/web                                           | 前端源码、HTTP 路由与内嵌资源 |
| package.json、starter.config.json、toolchain.json                        | 应用命令、布局和固定工具      |
| .trellis、AGENTS.md                                                      | 应用规范                      |

所有路径相对本应用根。公共后端与 UI 能力来自固定 Go kit/Dashboard 依赖；应用命令随本地 scripts 与受控 tools 源码交付，共享工具由主仓维护并按白名单导出。generated.go、models_gen.go、query/\*.gen.go、share/schema/generated 从源定义生成，不手改。

生成在本目录执行 pnpm generate；Go 包加载前先构建 SPA，沿用统一命令顺序。

`backend/internal/web` 统一使用 `package web`；前端构建输出到 `backend/internal/web/dist`，由 `embed.go` 嵌入、`assets.go` 解析资源清单。公开 SSR 模板与渲染保持在 `backend/internal/pages`。
