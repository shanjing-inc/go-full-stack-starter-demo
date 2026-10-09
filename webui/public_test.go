package webui

// 本文件覆盖公开页资源清单与嵌入构建产物的一致性。

import (
    "io/fs"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
)

func TestPublicAssetsMatchEmbeddedBuild(t *testing.T) {
    assets, err := PublicAssets()
    if err != nil {
        t.Fatal(err)
    }

    for _, path := range append(assets.CSS, assets.Script) {
        w := httptest.NewRecorder()
        Handler(http.NotFoundHandler()).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
        if w.Code != 200 || !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
            t.Fatal(path, w.Code, w.Header())
        }
    }

    script, _ := fs.ReadFile(files, "dist/"+strings.TrimPrefix(assets.Script, "/admin/"))
    if strings.Contains(string(script), "createRoot") || strings.Contains(string(script), "react-dom") {
        t.Fatal("公开页面脚本加载了完整 React 后台")
    }

    css, _ := fs.ReadFile(files, "dist/"+strings.TrimPrefix(assets.CSS[0], "/admin/"))
    for _, class := range []string{"min-w-", "900px", "tracking-", "grid-cols-"} {
        if !strings.Contains(string(css), class) {
            t.Fatal("公开模板样式缺失", class)
        }
    }
}
