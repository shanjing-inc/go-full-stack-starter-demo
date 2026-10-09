# 错误与日志

用于失败路径、认证、数据库和协议变化。入口：共享包 `transport/httperr/error.go`、`transport/graphql/errors.go`、`transport/httpx/server.go` 和应用配置/入口。

- 沿用 Go error、公开错误码白名单和适配器，不引入 AstroError/GraphQLError 类。
- 内部异常用服务端 slog，公开响应只保留允许的错误码/提示。保留 request_id、endpoint，不输出 DSN、Cookie、token、密码或私钥。
- REST 状态/JSON 与 GraphQL errors 是外部契约；测试非法请求、鉴权失败、内部异常脱敏。
- 启动检查失败在监听/消费前退出；沿用上下文、连接关闭和监管器清理边界。

验证：同目录错误/传输测试，断言公开响应无内部错误/凭据。日志与任务证据先脱敏。
