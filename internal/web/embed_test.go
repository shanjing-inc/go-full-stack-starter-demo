package web

// 本文件覆盖嵌入后台 SPA 的资源路径与回退行为。

import (
    "io/fs"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
)

func TestSPA(t *testing.T) {
    api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(404)
        w.Write([]byte(`{"error":"路由不存在"}`))
    })
    assets, _ := fs.Glob(files, "dist/assets/*.js")
    if len(assets) == 0 {
        t.Fatal("请先构建 SPA")
    }

    asset := "/admin/" + strings.TrimPrefix(assets[0], "dist/")
    cases := []struct {
        name, url, method string
        code              int
        content, cache    string
    }{
        {"首页", "/admin/", "GET", 200, "text/html", "no-cache"},
        {
            "深层路由",
            "/admin/tasks/detail",
            "GET",
            200,
            "text/html",
            "no-cache",
        },
        {"入口重定向", "/admin", "GET", 308, "text/html", ""},
        {"HEAD", "/admin/tasks", "HEAD", 200, "text/html", "no-cache"},
        {"资源", asset, "GET", 200, "javascript", "immutable"},
        {
            "丢失资源",
            "/admin/assets/missing.js",
            "GET",
            404,
            "text/plain",
            "",
        },
        {"目录", "/admin/assets", "GET", 404, "text/plain", ""},
        {"穿越", "/admin/%2e%2e/secrets", "GET", 404, "text/plain", ""},
        {"反斜线", "/admin/..%5csecrets", "GET", 404, "text/plain", ""},
        {"API保留", "/api/missing", "GET", 404, "application/json", ""},
        {"方法限制", "/admin/tasks", "POST", 405, "text/plain", ""},
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            w := httptest.NewRecorder()
            Handler(api).ServeHTTP(w, httptest.NewRequest(c.method, c.url, nil))
            r := w.Result()
            if r.StatusCode != c.code || !strings.Contains(r.Header.Get("Content-Type"), c.content) || !strings.Contains(r.Header.Get("Cache-Control"), c.cache) {
                t.Fatalf("响应 %d %v", r.StatusCode, r.Header)
            }
            if c.method == "HEAD" && w.Body.Len() != 0 {
                t.Fatal("HEAD 返回响应体")
            }
        })
    }
}

// TestWebHandlerServesPublicPagesAndSPA 核验合并后 SSR 与后台共享同一嵌入资源。
func TestWebHandlerServesPublicPagesAndSPA(t *testing.T) {
    assets, err := PublicAssets()
    if err != nil {
        t.Fatal(err)
    }

    handler := Handler(New(nil, Config{PublicAssets: assets}))
    for _, path := range []string{"/", "/test/queue", "/admin/", "/admin/tasks/detail"} {
        for _, method := range []string{http.MethodGet, http.MethodHead} {
            t.Run(method+path, func(t *testing.T) {
                response := httptest.NewRecorder()
                handler.ServeHTTP(response, httptest.NewRequest(method, path, nil))
                if response.Code != http.StatusOK || !strings.Contains(response.Header().Get("Content-Type"), "text/html") {
                    t.Fatal(response.Code, response.Header())
                }
                if method == http.MethodHead && response.Body.Len() != 0 {
                    t.Fatal("HEAD 返回响应体")
                }
                if method == http.MethodGet && (path == "/" || path == "/test/queue") {
                    for _, asset := range append(assets.CSS, assets.Script) {
                        if !strings.Contains(response.Body.String(), asset) {
                            t.Fatal("SSR 缺少构建资源引用", asset)
                        }
                    }
                }
            })
        }
    }
}
