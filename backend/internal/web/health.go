package web

import (
    "context"
    "net/http"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httpx"
    "github.com/labstack/echo/v5"
)

// WithHealth 在应用 HTTP 边界独立承接精确探针路径，不经过业务认证与会话 I/O。
func WithHealth(next http.Handler, ready func(context.Context) error) http.Handler {
    probes := httpx.New()
    probes.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
        return func(c *echo.Context) error {
            c.Response().Header().Set("Cache-Control", "no-store")
            return next(c)
        }
    })
    probes.GET(HealthPath+"/live", func(c *echo.Context) error {
        return c.JSON(http.StatusOK, map[string]string{"status": "alive"})
    })
    probes.GET(HealthPath+"/ready", func(c *echo.Context) error {
        check, done := context.WithTimeout(c.Request().Context(), time.Second)
        defer done()
        if ready(check) != nil {
            return c.JSON(http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
        }
        return c.JSON(http.StatusOK, map[string]string{"status": "ready"})
    })
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        switch r.URL.Path {
        case HealthPath, HealthPath + "/live", HealthPath + "/ready":
            probes.ServeHTTP(w, r)
        default:
            next.ServeHTTP(w, r)
        }
    })
}
