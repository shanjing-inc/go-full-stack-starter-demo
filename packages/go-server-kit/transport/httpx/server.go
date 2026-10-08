// Package httpx 提供 Echo 的公共入口约定。
package httpx

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/requestmeta"
    "errors"
    "github.com/google/uuid"
    "github.com/labstack/echo/v5"
    "github.com/labstack/echo/v5/middleware"
    "net/http"
)

// HealthPath 定义内部轻量健康检查路径。
const HealthPath = "/api/rest/internal/health"

// New 装配 Echo 恢复、错误白名单、请求标识与无缓存健康检查。
func New() *echo.Echo {
    e := echo.New()
    e.Use(middleware.RecoverWithConfig(middleware.RecoverConfig{DisablePrintStack: true}))
    e.HTTPErrorHandler = func(c *echo.Context, err error) {
        if response, unwrapErr := echo.UnwrapResponse(c.Response()); unwrapErr == nil && response.Committed {
            return
        }

        status, code, message := 500, "INTERNAL_SERVER_ERROR", "Unexpected error."
        var business *httperr.Error
        var httpErr echo.HTTPStatusCoder
        if errors.As(err, &business) && httperr.AllowedCode(business.Code) {
            code, message = business.Code, business.Message
            status = map[string]int{
                "BAD_USER_INPUT":      400,
                "FORBIDDEN":           403,
                "NOT_FOUND":           404,
                "CONFLICT":            409,
                "SERVICE_UNAVAILABLE": 503,
            }[code]
        } else if errors.As(err, &httpErr) {
            status = httpErr.StatusCode()
            code = "HTTP_ERROR"
            message = http.StatusText(status)
        }

        _ = c.JSON(status, map[string]any{"error": map[string]string{"code": code, "message": message}})
    }
    e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
        return func(c *echo.Context) error {
            request := c.Request()
            meta := requestmeta.RequestMeta{RequestID: uuid.NewString(), Endpoint: request.URL.Path}
            c.SetRequest(request.WithContext(requestmeta.WithRequestMeta(request.Context(), meta)))
            c.Response().Header().Set("X-Request-ID", meta.RequestID)
            return next(c)
        }
    })
    health := func(c *echo.Context) error {
        c.Response().Header().Set("Cache-Control", "no-store")
        c.Response().Header().Set("Content-Type", "text/plain; charset=utf-8")
        if c.Request().Method == http.MethodHead {
            return c.NoContent(200)
        }
        return c.String(200, "ok\n")
    }
    e.GET(HealthPath, health)
    e.HEAD(HealthPath, health)

    return e
}
