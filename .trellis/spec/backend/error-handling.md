# 错误与日志

用于失败路径、认证、数据库和协议变化。入口：共享包 `transport/httperr/error.go`、`transport/graphql/errors.go`、`transport/httpx/server.go` 和应用配置/入口。

- 沿用 Go error、公开错误码白名单和适配器，不引入 AstroError/GraphQLError 类。
- 内部异常用服务端 slog，公开响应只保留允许的错误码/提示。保留 request_id、endpoint，不输出 DSN、Cookie、token、密码或私钥。
- REST 状态/JSON 与 GraphQL errors 是外部契约；测试非法请求、鉴权失败、内部异常脱敏。
- 启动检查失败在监听/消费前退出；沿用上下文、连接关闭和监管器清理边界。

验证：同目录错误/传输测试，断言公开响应无内部错误/凭据。日志与任务证据先脱敏。

## 应用错误监控

`backend/internal/observability` 使用 sentry-go 独立 Client，`backend/internal/config` 读取 SENTRY_DSN/ENVIRONMENT/RELEASE，空 DSN 关闭。Echo 复用现有 recover/HTTPErrorHandler 并采集直接 5xx；GraphQL 通过 `GraphQLLogger` 订阅公共传输层的“GraphQL 操作异常”日志，避免修改公共 kit 的接口/固定版本。Worker middleware 保留错误身份和 panic/retry，进程配置加载后失败可采集，默认显式使用异步 HTTPTransport，退出最多额外 1 秒 flush，Close 释放传输资源；慢请求回归覆盖 SDK 默认 telemetry 关闭追加等待的边界。

事件白名单保留固定消息、公开部署标识、源码定位、合法 request_id 和固定 GraphQL 端点；请求、原始异常、用户、源码上下文与动态字段清除。预期业务错误/取消静默，监控故障安全降级；内存 transport 回归验证脱敏、默认关闭与故障隔离，真实 Sentry 送达另行验收。前端公开配置见应用 README 与 frontend/.env.example，Docker 支持三项 VITE_SENTRY 构建参数。
