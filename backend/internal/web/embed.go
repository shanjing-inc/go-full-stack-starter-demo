// 本文件嵌入应用前端构建产物，并接入后台 SPA Handler。
package web

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/spa"
    "embed"
    "io/fs"
    "net/http"
    "strings"
)

// files 保存构建时嵌入的后台与公开页资源产物。
//
//go:embed dist
var files embed.FS

// Handler 使用当前嵌入产物提供后台 SPA；开发模式为静态资源响应设置 no-store，其他请求保持 API 原响应链路。
func Handler(api http.Handler, development bool) http.Handler {
    root, _ := fs.Sub(files, "dist")
    handler := spa.Handler(api, root)
    if !development {
        return handler
    }
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path != "/admin" && !strings.HasPrefix(r.URL.Path, "/admin/") && !strings.HasPrefix(r.URL.Path, "/public/") {
            handler.ServeHTTP(w, r)
            return
        }
        response := &noStoreResponseWriter{ResponseWriter: w}
        handler.ServeHTTP(response, r)
        // SPA 的 HEAD 深链仅设置响应头，在此完成缓存策略与状态码输出。
        if !response.wroteHeader {
            response.WriteHeader(http.StatusOK)
        }
    })
}
