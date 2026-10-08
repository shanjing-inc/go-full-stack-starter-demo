# go-server-kit

团队共享的 Go 后端基础设施与传输适配包。应用维护自己的业务模型、GraphQL SDL／resolver、REST 路由、任务类型、迁移与入口组装。

```text
infra/
  config/       环境值读取
  logging/      JSON slog
  database/     GORM MySQL／PostgreSQL／纯 Go SQLite 工厂
    revision/   Atlas 只读版本门禁
  redisconn/    Redis URI、TLS／ACL 到 go-redis／Asynq 的映射
  cache/        JSON 缓存、显式 namespace 与正值 TTL
  lock/         随机 token 租约、原子续租与释放
  bus/          v1 Redis 信封、有限订阅、presence
  queue/        通用 Asynq 配置与入队
  schedule/     代码调度、Redis Leader 租约、共享启停
transport/
  httpx/        Echo 恢复、REST 错误与 request ID
  requestmeta/  请求上下文元信息
  graphql/      gqlgen、现有 HTTP 批处理与错误语义
  ws/           Origin 白名单、帧大小
  sse/          Go 原生流、刷新与写入期限
  spa/          深链托管、静态缓存、API 隔离
modules/
  auth/         标准账号表、邮箱密码、初始化与 Cookie／Bearer HTTP 接入
```

## 使用示例

当前仓库通过 `go.work` 联调两个正式 module；demo 内的本地 `replace` 同时支持 `GOWORK=off`。发布后以已经验收的公共包版本更新应用依赖。

```go
import (
    "context"
    "time"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/cache"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
)

// ctx 来自请求或受限启动生命周期。
driver, dsn, err := database.ParseDSN("mysql://dev:password@127.0.0.1:3306/demo")
if err != nil {
    return err
}
db, err := database.Open(ctx, driver, dsn)
if err != nil { return err }
pool, err := db.DB()
if err != nil { return err }
defer pool.Close()

store := cache.Store{Redis: redisClient, Prefix: "my-app:cache"}
return store.Set(context.Background(), "sample", map[string]int{"count": 1}, time.Minute)
```

## 接口与生命周期约定

- Redis client 与 GORM pool 的所有权属于创建它们的应用。`bus.New` 借用 Redis client；`Bus.Close` 关闭该 Bus 的订阅连接，调用方最终关闭 client。
- 每个 Bus 订阅都在 Redis ACK 后返回；调用方监听 `Done` 并清理。订阅有界，溢出与连接故障结束当前订阅；消息恢复策略由应用定义。
- `Lease.Token` 由持有者生成独立随机值，TTL 至少 1ms。续租和释放原子校验 token；长任务需要按自身时限续租。
- 调度表达式和时区定义在代码，共享开关写 Redis；Leader 只负责定时派发。唯一 Task ID 和业务幂等保护租约交接竞态。
- Asynq 采用至少一次任务语义；应用实现幂等副作用。默认加权队列，可显式设置严格优先级；任务默认完成保留 24 小时。
- GraphQL introspection 默认关闭，应用显式为开发模式开启。当前兼容 transport 处理 JSON 单结果、最多 10 项批处理和 1MiB 正文。
- RequestMeta 提供 request ID／endpoint 与应用 attributes；身份信息在服务端校验后注入 context。
- 数据库启动门禁检查最新迁移版本、完成数量、错误和登记类型；Atlas SQL 执行入口属于应用部署流程。

## 测试边界

默认单测直接运行；真实 Redis 测试需要 `REDIS_TEST_URL`。仓库 `pnpm verify` 提供隔离 Redis 与 MySQL，覆盖缓存 TTL／隔离、租约所有权、队列消费／重试状态／归档、调度共享开关／Leader 接管和传输生命周期。

公共 auth 模块已提供标准账号表与真实邮箱认证；完整权限、用户／会话管理进入 R2。正式发布、跨仓库取包与长期兼容策略按独立版本流程验收。

### 数据库方言

`database.ParseDSN(url)` 从 `mysql://`、`postgres://`、`postgresql://`、`sqlite://` 推导方言，返回驱动原生 DSN；MySQL 使用官方 DSN 编解码并保留连接参数，默认启用时间解析与 UTC，错误隐藏凭据。`database.Open(ctx, driver, dsn)` 接收解析结果或底层驱动原生 DSN，支持 `mysql`、`postgres`、`sqlite`；PostgreSQL 的 `database/sql` 注册名由 `database.SQLDriver` 转为 `pgx`。连接初始化继承调用方 deadline，唯一键与外键错误沿用公共错误合同。认证时间模型保留精度标签，最终字段类型由方言导出；PostgreSQL 管理员角色候选使用 C 排序规则保持严格匹配。

真实 PostgreSQL 测试使用 `POSTGRES_AUTH_TEST_DSN` 与隔离 Redis。仓库 `pnpm verify:postgresql` 创建专用容器数据库，覆盖初始化并发、旧密码／角色、会话、限流、用户查询和事务操作。
