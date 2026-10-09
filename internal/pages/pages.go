// Package pages 提供应用自己的公开 SSR 布局、首页和队列测试页。
package pages

import (
    "bytes"
    "embed"
    "html/template"
    "io/fs"
    "net/http"
    "time"

    records "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/queue"
    "github.com/labstack/echo/v5"
)

// files 嵌入公开页面模板与主题脚本。
//
//go:embed templates/*.gohtml theme.js
var files embed.FS

// Assets 指向 Vite manifest 中实际生成的带摘要资源。
type Assets struct {
    CSS    []string
    Script string
}

// Card 描述首页能力入口卡片。
type Card struct{ Title, Description, Href, Tag string }

// Queue 描述队列演示中的逻辑队列及消费权重。
type Queue struct {
    Name, Description string
    Weight            int
}

// Record 保存公开页面所需的执行展示字段。
type Record struct {
    Queue, JobID, Mode, Status, RequestedAt, ProcessedAt, Error string
    Attempt                                                     int
}

// Data 为共享布局提供页面内容、静态资源与当前账号的读取和投递能力。
type Data struct {
    Title, Description, Page, Message, UserName string
    RequestedAt                                 string
    Assets                                      Assets
    Cards                                       []Card
    Queues                                      []Queue
    Records                                     []Record
    CanRead, CanDispatch                        bool
}

var templates = template.Must(template.ParseFS(files, "templates/*.gohtml"))

// Home 构造公开首页内容及能力入口。
func Home(assets Assets) Data {
    return Data{
        Title:       "Go 全栈示例",
        Description: "Go SSR、React 后台、GraphQL 与队列能力演示。",
        Page:        "home",
        Assets:      assets,
        Cards: []Card{
            {
                "队列测试",
                "投递成功、失败一次或持续失败任务，查看 Worker 执行记录。",
                "/test/queue",
                "Asynq",
            },
            {
                "管理后台",
                "管理店铺、用户和队列，验证 React SPA、权限与 GraphQL。",
                "/admin/",
                "React SPA",
            },
        },
    }
}

// QueuePage 构造队列演示页面的默认数据，并生成 UTC 请求时间。
func QueuePage(assets Assets) Data {
    return Data{
        Title:       "Queue Test",
        Description: "测试 Asynq 多队列投递、失败模式与执行记录。",
        Page:        "queue",
        Assets:      assets,
        RequestedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
        Queues: []Queue{
            {"critical", "高优先级任务队列", 6},
            {"default", "默认优先级任务队列", 3},
            {"low", "低优先级任务队列", 1},
        },
    }
}

// ProjectRecord 把安全执行记录映射到页面字段，统一排队与执行中的展示状态。
func ProjectRecord(row *records.Record) Record {
    mode, requested := "-", "-"
    if payload, ok := row.Data.(map[string]any); ok {
        if value, ok := payload["mode"].(string); ok {
            mode = value
        }
        if value, ok := payload["requestedAt"].(string); ok {
            requested = value
        }
    }

    processed := "-"
    if row.ProcessedAt != nil {
        processed = time.UnixMilli(int64(*row.ProcessedAt)).UTC().Format("2006-01-02T15:04:05.000Z")
    }

    status := row.Status
    switch status {
    case "waiting", "delayed":
        status = "queued"
    case "active":
        status = "processing"
    }

    return Record{
        Queue:       row.QueueName,
        JobID:       row.JobID,
        Mode:        mode,
        Status:      status,
        RequestedAt: requested,
        ProcessedAt: processed,
        Error:       row.FailedReason,
        Attempt:     row.Attempts,
    }
}

// Render 先在缓冲区完成渲染，保证模板错误仍可返回完整错误页。
func Render(c *echo.Context, data Data, status int) error {
    var body bytes.Buffer
    if err := templates.ExecuteTemplate(&body, "layout", data); err != nil {
        return err
    }
    c.Response().Header().Set("Cache-Control", "no-store")
    c.Response().Header().Set("X-Content-Type-Options", "nosniff")
    c.Response().Header().Set("Content-Type", "text/html; charset=utf-8")
    if c.Request().Method == http.MethodHead {
        return c.NoContent(status)
    }
    return c.HTML(status, body.String())
}

// Theme 提供无缓存的嵌入主题脚本，HEAD 只返回响应头。
func Theme(c *echo.Context) error {
    data, err := fs.ReadFile(files, "theme.js")
    if err != nil {
        return err
    }
    c.Response().Header().Set("Cache-Control", "no-cache")
    c.Response().Header().Set("X-Content-Type-Options", "nosniff")
    if c.Request().Method == http.MethodHead {
        c.Response().Header().Set("Content-Type", "text/javascript; charset=utf-8")
        return c.NoContent(http.StatusOK)
    }
    return c.Blob(http.StatusOK, "text/javascript; charset=utf-8", data)
}
