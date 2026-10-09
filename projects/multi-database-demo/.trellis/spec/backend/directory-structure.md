# 目录与职责

| 入口                                                        | 职责                           |
| ----------------------------------------------------------- | ------------------------------ |
| 应用 `cmd/web`、`cmd/worker`                                | 组装、启动检查、退出清理       |
| 应用 `internal/config`                                      | 环境解析与配置脱敏             |
| 应用 `internal/model`、`internal/service`                   | 实体、业务、查询、事务         |
| 应用 `internal/graph/{member,admin,model,scalar}`           | 双 Schema resolver、DTO、标量  |
| 应用 `schema`、`gqlgen-*.yml`、`cmd/gen`、`cmd/schema`      | SDL、gqlgen、Gen、目标 Schema  |
| 应用 `internal/query`、`migrations/{mysql,postgres,sqlite}` | 生成查询与版本迁移             |
| 应用 `internal/{realtime,protocol,tasks,pages}`             | 实时、协议、队列业务、SSR      |
| 应用 `webui`                                                | SPA 内嵌、公开资源             |
| `packages/go-server-kit/{infra,modules,transport}`          | DB/Redis、认证/队列、协议适配  |
| `scripts/project.py`、`scripts/dev.py`、`tools`             | 统一生成、开发、验证与固定工具 |

应用指 `projects/multi-database-demo`。通用能力先查共享包，应用命名/装配留在 demo。`generated.go`、`models_gen.go`、`internal/query/*.gen.go`、`schema/generated` 从源定义生成，不手改；新增业务不落回历史 `poc`。

验证：改生成源后在工作区根执行 `rtk pnpm generate`，核对生成 diff。Go 编译依赖 SPA 快照，沿用先前端后 Go 的统一脚本顺序。
