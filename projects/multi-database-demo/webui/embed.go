// Package webui 嵌入应用自己的 SPA 构建产物。
package webui

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/spa"
    "embed"
    "io/fs"
    "net/http"
)

// files 保存构建时嵌入的后台与公开页资源产物。
//
//go:embed dist
var files embed.FS

// Handler 使用当前嵌入产物提供后台 SPA，其他请求继续交给 API。
func Handler(api http.Handler) http.Handler {
    root, _ := fs.Sub(files, "dist")
    return spa.Handler(api, root)
}
