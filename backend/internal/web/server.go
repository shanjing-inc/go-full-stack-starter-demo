// Package web 组装应用 HTTP 路由、独立 GraphQL Schema 与内嵌前端资源。
package web

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    queuerecords "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/queue"
    graphqltransport "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/graphql"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httpx"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/requestmeta"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/graph/admin"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/graph/member"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/pages"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
    "context"
    gql "github.com/99designs/gqlgen/graphql"
    "github.com/99designs/gqlgen/graphql/handler/transport"
    "github.com/labstack/echo/v5"
    "log/slog"
    "strconv"
)

// MemberPath 定义成员 GraphQL 端点。
const MemberPath = "/api/graphql/member"

// AdminPath 定义后台 GraphQL 端点。
const AdminPath = "/api/graphql/admin"

// HealthPath 沿用公共内部健康检查路径。
const HealthPath = "/api/rest/internal/health"

// ProbePath 定义兼容测试使用的店铺 REST 探针。
const ProbePath = "/api/rest/poc/shops/:id"

// Config 注入页面资源、店铺周边能力、认证及 GraphQL 传输策略。
type Config struct {
    PublicAssets     pages.Assets
    QueueTest        QueueTestDispatcher
    QueueTestRecords QueueTestRecords
    Queue            *queuerecords.Service
    AllowedOrigins   []string
    Logger           *slog.Logger
    Introspection    bool
    Authentication   *auth.Service
}

// New 装配公开页、店铺 REST 和独立双 GraphQL Schema，共享应用业务服务。
func New(shops service.Shops, config Config) *echo.Echo {
    e := httpx.New()
    registerPages(e, config)
    // 探针仅用于兼容测试，由 demo 入口解释。
    e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
        return func(c *echo.Context) error {
            request := c.Request()
            meta, _ := requestmeta.RequestFrom(request.Context())
            cookie := ""
            if value, err := request.Cookie("poc-probe"); err == nil {
                cookie = value.Value
            }

            meta.Attributes = map[string]string{"probeHeader": request.Header.Get("X-POC-Probe"), "probeCookie": cookie}
            c.SetRequest(request.WithContext(requestmeta.WithRequestMeta(request.Context(), meta)))
            return next(c)
        }
    })
    shopHandler := func(c *echo.Context) error {
        id, err := strconv.Atoi(c.Param("id"))
        if err != nil || id <= 0 {
            return &service.Error{Code: "BAD_USER_INPUT", Message: "id 需要正整数"}
        }

        row, err := shops.Get(c.Request().Context(), service.Lookup{ID: &id})
        if err != nil {
            return err
        }
        if row == nil {
            return &service.Error{Code: "NOT_FOUND", Message: "目标资源不存在"}
        }
        return c.JSON(200, map[string]any{"data": map[string]any{
            "id":     strconv.Itoa(row.ID),
            "name":   row.Name,
            "slug":   row.Slug,
            "status": row.Status,
        }})
    }
    e.GET("/api/rest/demo/shops/:id", shopHandler)
    e.GET(ProbePath, shopHandler)

    memberServer := graphqltransport.NewServer(member.NewExecutableSchema(member.Config{Resolvers: &member.Resolver{Shops: shops, Users: config.Authentication}}), graphqltransport.Config{
        AllowedOrigins: config.AllowedOrigins,
        Logger:         config.Logger,
        Introspection:  config.Introspection,
    })
    memberServer.AroundFields(func(ctx context.Context, next gql.Resolver) (any, error) {
        field := gql.GetFieldContext(ctx)
        if config.Authentication != nil && field != nil && (field.Object == "Query" || field.Object == "Mutation") && !(field.Object == "Mutation" && (field.Field.Name == "signInWithEmail" || field.Field.Name == "signOut")) {
            if err := config.Authentication.RequireUser(ctx); err != nil {
                return nil, err
            }
        }
        return next(ctx)
    })
    memberServer.AddTransport(transport.GET{})
    memberServer.AddTransport(transport.POST{})
    e.Any(MemberPath, echo.WrapHandler(graphqltransport.CompatibleTransport(memberServer, graphqltransport.Config{AllowedOrigins: config.AllowedOrigins})))
    adminServer := graphqltransport.NewServer(admin.NewExecutableSchema(admin.Config{Resolvers: &admin.Resolver{Shops: shops, Users: config.Authentication, Queue: config.Queue}}), graphqltransport.Config{
        AllowedOrigins: config.AllowedOrigins,
        Logger:         config.Logger,
        Introspection:  config.Introspection,
    })
    // 按实际 Schema 字段执行门禁，覆盖别名、fragment 和每个 batch 成员。
    adminServer.AroundFields(func(ctx context.Context, next gql.Resolver) (any, error) {
        field := gql.GetFieldContext(ctx)
        if config.Authentication != nil && field != nil && (field.Object == "Query" || field.Object == "Mutation") {
            public := field.Object == "Query" && field.Field.Name == "getInstallStatus" || field.Object == "Mutation" && (field.Field.Name == "initializeAdmin" || field.Field.Name == "signInWithEmail" || field.Field.Name == "signOut")
            if !public {
                if err := config.Authentication.RequireAdmin(ctx); err != nil {
                    return nil, err
                }
            }
        }
        return next(ctx)
    })
    adminServer.AddTransport(transport.GET{})
    adminServer.AddTransport(transport.POST{})
    e.Any(AdminPath, echo.WrapHandler(graphqltransport.CompatibleTransport(adminServer, graphqltransport.Config{AllowedOrigins: config.AllowedOrigins})))
    return e
}
