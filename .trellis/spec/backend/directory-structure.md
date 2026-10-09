# 应用目录

| 入口                                              | 职责                     |
| ------------------------------------------------- | ------------------------ |
| cmd/web、cmd/worker                               | 组装、启动、退出         |
| internal/config                                   | 环境解析、脱敏           |
| internal/model、internal/service                  | 模型、业务、事务         |
| internal/graph/{member,admin,model,scalar}        | Schema/resolver/DTO/标量 |
| schema、gqlgen-\*.yml、cmd/gen、cmd/schema        | 生成源与目标 Schema      |
| internal/query、migrations                        | 生成查询与版本迁移       |
| internal/{realtime,protocol,tasks,pages}          | 实时、队列、SSR          |
| frontend、webui                                   | React 应用与内嵌资源     |
| package.json、starter.config.json、toolchain.json | 应用命令、布局和固定工具 |
| .trellis、AGENTS.md                               | 应用规范                 |

所有路径相对本应用根。通用能力来自固定 Go kit/Dashboard/devtools 依赖；共享源码维护在主仓，本应用不携带。generated.go、models_gen.go、query/\*.gen.go、schema/generated 从源定义生成，不手改。

生成在本目录执行 pnpm generate；Go 包加载前先构建 SPA，沿用统一命令顺序。
