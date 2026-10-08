// Package graphql 提供兼容既有 JSON HTTP 契约的 gqlgen 适配。
package graphql

import (
    "context"
    "errors"
    gql "github.com/99designs/gqlgen/graphql"
    "github.com/99designs/gqlgen/graphql/handler"
    "github.com/99designs/gqlgen/graphql/handler/extension"
    "github.com/99designs/gqlgen/graphql/handler/transport"
    "log/slog"
    "net/http"
)

// Config 配置精确来源白名单、日志器与 Schema 内省开关。
type Config struct {
    AllowedOrigins []string
    Logger         *slog.Logger
    Introspection  bool
}

func (c Config) originAllowed(origin string) bool {
    for _, allowed := range c.AllowedOrigins {
        if allowed == origin {
            return true
        }
    }

    return false
}

// Handler 装配 GET/POST、错误脱敏、复杂度上限和可选内省，并应用兼容传输层。
func Handler(schema gql.ExecutableSchema, c Config) http.Handler {
    logger := c.Logger
    if logger == nil {
        logger = slog.Default()
    }

    h := handler.New(schema)
    h.AddTransport(transport.GET{})
    h.AddTransport(transport.POST{})
    h.SetErrorPresenter(ErrorPresenter(logger))
    h.SetRecoverFunc(func(context.Context, any) error { return errors.New("GraphQL 执行发生异常") })
    h.Use(extension.FixedComplexityLimit(100))
    if c.Introspection {
        h.Use(extension.Introspection{})
    }
    return CompatibleTransport(h, c)
}
