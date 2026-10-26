package web_test

// 本文件验证探针在固定 kit 与工作区模式中均独立于业务认证链路。
import (
    "context"
    "errors"
    "net/http"
    "net/http/httptest"
    "path/filepath"
    "strings"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
    "github.com/labstack/echo/v5"
)

func TestHealthIndependentOfAuthentication(t *testing.T) {
    db, err := database.Open(context.Background(), "sqlite", filepath.Join(t.TempDir(), "health.sqlite"))
    if err != nil {
        t.Fatal(err)
    }
    sqlDB, _ := db.DB()
    t.Cleanup(func() { _ = sqlDB.Close() })
    authentication, err := auth.New(db, auth.Config{Secret: "test-secret-with-at-least-32-bytes", Origins: []string{"http://localhost"}})
    if err != nil {
        t.Fatal(err)
    }
    api := subject.New(newMemory(), subject.Config{})
    for _, path := range []string{subject.HealthPath + "/details", subject.HealthPath + "/live/details", subject.HealthPath + "/ready/", "/api/rest/private"} {
        api.GET(path, func(c *echo.Context) error { return c.NoContent(204) })
    }
    if err := authentication.Register(api, sessionLimiter{}); err != nil {
        t.Fatal(err)
    }
    if err := sqlDB.Close(); err != nil {
        t.Fatal(err)
    }
    checks := 0
    handler := subject.WithHealth(subject.Handler(api, false), func(ctx context.Context) error {
        checks++
        deadline, ok := ctx.Deadline()
        if !ok || time.Until(deadline) > time.Second {
            t.Fatal("就绪检查缺少一秒期限")
        }
        return nil
    })
    for _, token := range []string{"", "Bearer expired-token"} {
        for _, tc := range []struct {
            method, path, body string
            status             int
        }{
            {"GET", subject.HealthPath, "ok\n", 200},
            {"HEAD", subject.HealthPath, "", 200},
            {"GET", subject.HealthPath + "/live", "{\"status\":\"alive\"}\n", 200},
            {"GET", subject.HealthPath + "/ready", "{\"status\":\"ready\"}\n", 200},
            {"POST", subject.HealthPath + "/ready", "", 405},
        } {
            request := httptest.NewRequest(tc.method, tc.path, nil)
            request.Header.Set("Authorization", token)
            request.Header.Set("Origin", "https://untrusted.example")
            response := httptest.NewRecorder()
            handler.ServeHTTP(response, request)
            if response.Code != tc.status || (tc.status == 200 && response.Body.String() != tc.body) {
                t.Fatalf("%s %s: %d %s", tc.method, tc.path, response.Code, response.Body.String())
            }
            if response.Header().Get("X-Request-ID") == "" {
                t.Fatal("探针缺少请求标识")
            }
            if tc.status == 200 && response.Header().Get("Cache-Control") != "no-store" {
                t.Fatal("探针应禁止缓存")
            }
        }
    }
    if checks != 2 {
        t.Fatalf("仅 GET ready 应检查依赖，实际 %d 次", checks)
    }
    for _, path := range []string{subject.HealthPath + "/details", subject.HealthPath + "/live/details", subject.HealthPath + "/ready/", "/api/rest/private"} {
        response := httptest.NewRecorder()
        handler.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
        if response.Code != http.StatusUnauthorized {
            t.Fatalf("业务路径 %s 绕过认证：%d", path, response.Code)
        }
    }
}

func TestHealthReadinessFailure(t *testing.T) {
    for _, timeout := range []bool{false, true} {
        handler := subject.WithHealth(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("探针进入业务链路") }), func(ctx context.Context) error {
            if timeout {
                <-ctx.Done()
                return ctx.Err()
            }
            return errors.New("private database credentials")
        })
        response := httptest.NewRecorder()
        handler.ServeHTTP(response, httptest.NewRequest("GET", subject.HealthPath+"/ready", nil))
        if response.Code != 503 || strings.TrimSpace(response.Body.String()) != `{"status":"unavailable"}` {
            t.Fatalf("依赖异常应脱敏：%d %s", response.Code, response.Body.String())
        }
        live := httptest.NewRecorder()
        handler.ServeHTTP(live, httptest.NewRequest("GET", subject.HealthPath+"/live", nil))
        if live.Code != 200 {
            t.Fatalf("依赖异常不影响存活：%d", live.Code)
        }
    }
}
