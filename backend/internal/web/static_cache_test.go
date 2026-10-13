package web

import (
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestStaticCachePolicyByEnvironment(t *testing.T) {
    assets, err := PublicAssets()
    if err != nil {
        t.Fatal(err)
    }
    const immutable = "public, max-age=31536000, immutable"
    cases := []struct {
        name, path, productionCache string
        status                      int
    }{
        {"后台首页", "/admin/", "no-cache", http.StatusOK},
        {"后台深链", "/admin/tasks/detail", "no-cache", http.StatusOK},
        {"入口文件", "/admin/index.html", "no-cache", http.StatusMovedPermanently},
        {"公开页面脚本", assets.Script, immutable, http.StatusOK},
        {"公开页面样式", assets.CSS[0], immutable, http.StatusOK},
        {"主题脚本", "/public/theme.js", "no-cache", http.StatusOK},
        {"固定文件名资源", "/admin/manifest.json", "no-cache", http.StatusOK},
        {"入口重定向", "/admin", "", http.StatusPermanentRedirect},
        {"缺失资源", "/admin/assets/missing.js", "", http.StatusNotFound},
        {"目录访问", "/admin/assets", "", http.StatusNotFound},
        {"路径穿越", "/admin/%2e%2e/secrets", "", http.StatusNotFound},
    }
    for _, mode := range []struct {
        name        string
        development bool
    }{{"开发", true}, {"生产", false}} {
        t.Run(mode.name, func(t *testing.T) {
            handler := Handler(New(nil, Config{PublicAssets: assets}), mode.development)
            for _, tc := range cases {
                for _, method := range []string{http.MethodGet, http.MethodHead} {
                    t.Run(tc.name+"/"+method, func(t *testing.T) {
                        recorder := httptest.NewRecorder()
                        handler.ServeHTTP(recorder, httptest.NewRequest(method, tc.path, nil))
                        response := recorder.Result()
                        defer response.Body.Close()
                        wantCache := tc.productionCache
                        if mode.development {
                            wantCache = "no-store"
                        }
                        if response.StatusCode != tc.status || response.Header.Get("Cache-Control") != wantCache {
                            t.Fatalf("响应状态=%d 缓存头=%q，期望状态=%d 缓存头=%q", response.StatusCode, response.Header.Get("Cache-Control"), tc.status, wantCache)
                        }
                        if method == http.MethodHead && tc.status < http.StatusBadRequest && recorder.Body.Len() != 0 {
                            t.Fatal("HEAD 返回响应体")
                        }
                    })
                }
            }
            t.Run("范围请求", func(t *testing.T) {
                request := httptest.NewRequest(http.MethodGet, assets.Script, nil)
                request.Header.Set("Range", "bytes=0-9")
                recorder := httptest.NewRecorder()
                handler.ServeHTTP(recorder, request)
                response := recorder.Result()
                defer response.Body.Close()
                wantCache := immutable
                if mode.development {
                    wantCache = "no-store"
                }
                if response.StatusCode != http.StatusPartialContent || response.Header.Get("Cache-Control") != wantCache || recorder.Body.Len() != 10 {
                    t.Fatalf("范围请求响应=%d %v，正文长度=%d", response.StatusCode, response.Header, recorder.Body.Len())
                }
            })
        })
    }
}

func TestDevelopmentCacheOverrideBeforeHeadersAreWritten(t *testing.T) {
    for _, status := range []int{http.StatusOK, http.StatusPartialContent, http.StatusNotModified} {
        t.Run(http.StatusText(status), func(t *testing.T) {
            api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
                w.Header().Set("X-Static-Test", "preserved")
                if status == http.StatusOK {
                    _, _ = w.Write([]byte("主题脚本"))
                    return
                }
                w.WriteHeader(status)
            })
            recorder := httptest.NewRecorder()
            Handler(api, true).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/public/theme.js", nil))
            response := recorder.Result()
            defer response.Body.Close()
            if response.StatusCode != status || response.Header.Get("Cache-Control") != "no-store" || response.Header.Get("X-Static-Test") != "preserved" {
                t.Fatalf("已发送响应头=%d %v", response.StatusCode, response.Header)
            }
        })
    }
}

func TestDevelopmentStaticCachePreservesAPIResponseWriter(t *testing.T) {
    for _, path := range []string{"/api/rest/demo/test", "/api/events", "/api/websocket", "/health", "/administrator", "/publicity"} {
        t.Run(path, func(t *testing.T) {
            recorder := httptest.NewRecorder()
            api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                if w != recorder {
                    t.Fatal("API 响应 writer 被替换")
                }
                w.Header().Set("Cache-Control", "no-cache, no-transform")
                w.WriteHeader(http.StatusAccepted)
            })
            Handler(api, true).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
            response := recorder.Result()
            defer response.Body.Close()
            if response.StatusCode != http.StatusAccepted || response.Header.Get("Cache-Control") != "no-cache, no-transform" {
                t.Fatalf("API 响应=%d %v", response.StatusCode, response.Header)
            }
        })
    }
}
