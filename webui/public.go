package webui

import (
    "encoding/json"
    "errors"
    "io/fs"
    "strings"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/pages"
)

// PublicAssets 解析当前构建 manifest，确保 SSR 引用与内嵌资源属于同一次构建。
func PublicAssets() (pages.Assets, error) {
    raw, err := fs.ReadFile(files, "dist/manifest.json")
    if err != nil {
        return pages.Assets{}, errors.New("公开页面构建 manifest 缺失，请先构建前端")
    }

    var manifest map[string]struct {
        File         string
        CSS, Imports []string
    }
    if json.Unmarshal(raw, &manifest) != nil {
        return pages.Assets{}, errors.New("公开页面构建 manifest 无效")
    }

    entry, ok := manifest["src/public.ts"]
    if !ok || entry.File == "" {
        return pages.Assets{}, errors.New("公开页面脚本入口缺失")
    }

    assets := pages.Assets{}
    seen, css := map[string]bool{}, map[string]bool{}
    valid := func(file string) bool {
        if !strings.HasPrefix(file, "assets/") || !fs.ValidPath(file) {
            return false
        }

        _, err := fs.Stat(files, "dist/"+file)
        return err == nil
    }
    if !valid(entry.File) {
        return assets, errors.New("公开页面脚本产物缺失")
    }

    assets.Script = "/admin/" + entry.File
    var visit func(string) error
    visit = func(key string) error {
        if seen[key] {
            return nil
        }

        seen[key] = true
        row, ok := manifest[key]
        if !ok {
            return errors.New("公开页面依赖产物缺失")
        }

        for _, imported := range row.Imports {
            if err := visit(imported); err != nil {
                return err
            }
        }

        for _, file := range row.CSS {
            if !valid(file) {
                return errors.New("公开页面样式产物缺失")
            }
            if !css[file] {
                css[file] = true
                assets.CSS = append(assets.CSS, "/admin/"+file)
            }
        }

        return nil
    }
    if err := visit("src/public.ts"); err != nil {
        return pages.Assets{}, err
    }
    if len(assets.CSS) == 0 {
        return pages.Assets{}, errors.New("公开页面样式入口缺失")
    }
    return assets, nil
}
