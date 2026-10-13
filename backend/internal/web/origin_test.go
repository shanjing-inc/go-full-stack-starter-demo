package web_test

import (
    "context"
    "net/http"
    "path/filepath"
    "strings"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
)

// TestLocalOriginsAcrossWebEntrypoints 验证认证 Guard、CORS、双 GraphQL 与真实 SSR 路由采用一致规则。
func TestLocalOriginsAcrossWebEntrypoints(t *testing.T) {
    db, err := database.Open(context.Background(), "sqlite", filepath.Join(t.TempDir(), "origins.sqlite"))
    if err != nil {
        t.Fatal(err)
    }
    sql, _ := db.DB()
    t.Cleanup(func() { _ = sql.Close() })
    if err := db.AutoMigrate(auth.Models()...); err != nil {
        t.Fatal(err)
    }
    role := "owner"
    user := auth.User{ID: 1, Name: "本地来源回归用户", Email: "origin@example.test", Role: &role}
    if err := db.Create(&user).Error; err != nil {
        t.Fatal(err)
    }
    session := auth.Session{UserID: user.ID, Token: "local-origin-token", ExpiresAt: time.Now().Add(time.Hour)}
    if err := db.Create(&session).Error; err != nil {
        t.Fatal(err)
    }
    rules := []string{"http://localhost:*", "http://127.0.0.1:*"}
    authentication, err := auth.New(db, auth.Config{
        Secret: "test-secret-with-at-least-32-bytes", Development: true, Origins: rules,
        AdminPaths: []string{subject.AdminPath},
    })
    if err != nil {
        t.Fatal(err)
    }
    queue := &pageQueue{}
    api := subject.New(newMemory(), subject.Config{
        Authentication: authentication, AllowedOrigins: rules,
        QueueTest: queue, QueueTestRecords: queue,
    })
    if err := authentication.Register(api, sessionLimiter{}); err != nil {
        t.Fatal(err)
    }
    for _, value := range []string{"http://localhost:5174", "http://127.0.0.1:8081"} {
        for _, item := range []struct{ method, path, body string }{
            {"POST", subject.AdminPath, `{"query":"{getCurrentUser{id name}}"}`},
            {"POST", subject.MemberPath, `{"query":"{__typename}"}`},
            {"GET", "/test/queue", ""},
        } {
            t.Run(value+item.path, func(t *testing.T) {
                response := perform(api, item.method, item.path, item.body, map[string]string{
                    "Authorization": "Bearer local-origin-token", "Origin": value, "Sec-Fetch-Site": "same-site",
                })
                if response.Code != http.StatusOK || response.Header().Get("Access-Control-Allow-Origin") != value || response.Header().Get("Access-Control-Allow-Credentials") != "true" {
                    t.Fatalf("入口 %s：%d %s，%v", item.path, response.Code, response.Body.String(), response.Header())
                }
                if item.path == subject.AdminPath && !strings.Contains(response.Body.String(), "本地来源回归用户") {
                    t.Fatal("后台 GraphQL 应返回当前用户", response.Body.String())
                }
                if item.path == subject.MemberPath && !strings.Contains(response.Body.String(), `"__typename":"Query"`) {
                    t.Fatal("成员 GraphQL 应执行请求", response.Body.String())
                }
                if item.path == "/test/queue" && !strings.Contains(response.Body.String(), "本地来源回归用户") {
                    t.Fatal("SSR 应通过来源与会话校验", response.Body.String())
                }
            })
        }
    }
    for _, item := range []struct{ origin, site string }{
        {"http://localhost.example:5174", "same-site"},
        {"http://localhost:5174", "cross-site"},
    } {
        response := perform(api, "POST", subject.AdminPath, `{"query":"{getCurrentUser{id}}"}`, map[string]string{
            "Authorization": "Bearer local-origin-token", "Origin": item.origin, "Sec-Fetch-Site": item.site,
        })
        if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源无效") {
            t.Fatalf("后台来源保护：%d %s", response.Code, response.Body.String())
        }
    }
}
