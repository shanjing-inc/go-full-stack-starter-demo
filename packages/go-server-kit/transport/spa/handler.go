// Package spa 提供后台深链回退、静态资源缓存和 API 路由隔离。
package spa

import (
    "io/fs"
    "net/http"
    "path"
    "strings"
)

// Handler 把 /admin/ 静态资源与后台深链交给嵌入 SPA，其他路径交给 API；带扩展名的资源缺失返回 404。
func Handler(api http.Handler, root fs.FS) http.Handler {
    static := http.FileServer(http.FS(root))
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path == "/admin" {
            http.Redirect(w, r, "/admin/", http.StatusPermanentRedirect)
            return
        }
        if !strings.HasPrefix(r.URL.Path, "/admin/") {
            api.ServeHTTP(w, r)
            return
        }
        if r.Method != http.MethodGet && r.Method != http.MethodHead {
            w.Header().Set("Allow", "GET, HEAD")
            http.Error(w, "方法无效", 405)
            return
        }

        name := strings.TrimPrefix(r.URL.Path, "/admin/")
        for _, part := range strings.Split(name, "/") {
            if part == ".." || part == "." || strings.Contains(part, "\\") {
                http.NotFound(w, r)
                return
            }
        }

        if strings.ContainsRune(name, '\x00') || (name != "" && !fs.ValidPath(name)) {
            http.NotFound(w, r)
            return
        }
        if name != "" {
            item, err := fs.Stat(root, name)
            if err == nil && !item.IsDir() {
                w.Header().Set("Cache-Control", "no-cache")
                if strings.HasPrefix(name, "assets/") {
                    w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
                }

                clone := r.Clone(r.Context())
                clone.URL.Path = "/" + name
                static.ServeHTTP(w, clone)
                return
            }
            if strings.HasPrefix(name, "assets/") || path.Ext(name) != "" || (err == nil && item.IsDir()) {
                http.NotFound(w, r)
                return
            }
        }

        data, err := fs.ReadFile(root, "index.html")
        if err != nil {
            http.Error(w, "SPA 产物缺失", 503)
            return
        }
        w.Header().Set("Content-Type", "text/html; charset=utf-8")
        w.Header().Set("Cache-Control", "no-cache")
        if r.Method == http.MethodGet {
            _, _ = w.Write(data)
        }
    })
}
