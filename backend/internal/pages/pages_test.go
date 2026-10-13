package pages_test

// 本文件覆盖SSR 页面结构、队列数据转义和兼容字段投影。

import (
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
    "time"

    records "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/queue"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/pages"

    "github.com/labstack/echo/v5"
)

func TestServerRenderedPages(t *testing.T) {
    assets := subject.Assets{CSS: []string{"/admin/assets/style-test.css"}, Script: "/admin/assets/public-test.js"}
    for _, page := range []subject.Data{subject.Home(assets), subject.QueuePage(assets), subject.BusPage(assets)} {
        t.Run(page.Page, func(t *testing.T) {
            e := echo.New()
            w := httptest.NewRecorder()
            if err := subject.Render(e.NewContext(httptest.NewRequest(http.MethodGet, "/", nil), w), page, 200); err != nil {
                t.Fatal(err)
            }

            body := w.Body.String()
            for _, text := range []string{
                "<!doctype html>",
                `<html lang="zh-CN">`,
                `<meta name="description"`,
                `<h1`,
                assets.CSS[0],
                assets.Script,
            } {
                if !strings.Contains(body, text) {
                    t.Fatalf("SSR 缺少 %s", text)
                }
            }

            if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Content-Type") != "text/html; charset=utf-8" {
                t.Fatal(w.Header())
            }

            head := httptest.NewRecorder()
            if err := subject.Render(e.NewContext(httptest.NewRequest(http.MethodHead, "/", nil), head), page, 200); err != nil {
                t.Fatal(err)
            }
            if head.Body.Len() != 0 || head.Code != 200 {
                t.Fatal("HEAD 响应无效")
            }
        })
    }
}

func TestTemplateEscapesQueueData(t *testing.T) {
    data := subject.QueuePage(subject.Assets{})
    data.CanRead = true
    data.UserName = `<script>alert("user")</script>`
    data.Records = []subject.Record{{JobID: `<img src=x onerror=alert(1)>`, Error: `<script>alert("error")</script>`}}
    w := httptest.NewRecorder()
    e := echo.New()
    if err := subject.Render(e.NewContext(httptest.NewRequest("GET", "/test/queue", nil), w), data, 200); err != nil {
        t.Fatal(err)
    }

    body := w.Body.String()
    if strings.Contains(body, data.UserName) || strings.Contains(body, data.Records[0].JobID) || strings.Contains(body, data.Records[0].Error) {
        t.Fatal("模板未转义用户输入")
    }
    if !strings.Contains(body, "&lt;script&gt;") || !strings.Contains(body, "&lt;img") {
        t.Fatal("转义内容缺失")
    }
}

func TestQueuePageKeepsReferenceStructure(t *testing.T) {
    data := subject.QueuePage(subject.Assets{})
    data.CanRead, data.CanDispatch = true, true
    data.Records = []subject.Record{{
        Queue:  "default",
        JobID:  "reference-task",
        Mode:   "success",
        Status: "completed",
    }}
    e := echo.New()
    w := httptest.NewRecorder()
    if err := subject.Render(e.NewContext(httptest.NewRequest(http.MethodGet, "/test/queue", nil), w), data, http.StatusOK); err != nil {
        t.Fatal(err)
    }

    body := w.Body.String()
    for _, label := range []string{
        "触发成功任务",
        "失败一次（可 Retry）",
        "持续失败",
    } {
        if strings.Count(body, ">"+label+"</button>") != 3 {
            t.Fatalf("三个队列分别提供 %s 按钮", label)
        }
    }

    for _, label := range []string{
        "派发 高优先级任务队列",
        "派发 默认优先级任务队列",
        "派发 低优先级任务队列",
        "当前请求结果",
        "刷新执行状态",
        "最近一次动作：",
        "请求时间：",
        "最近执行记录",
        ">attempt</th>",
        ">requestedAt</th>",
    } {
        if !strings.Contains(body, label) {
            t.Fatalf("原版页面结构缺少 %s", label)
        }
    }

    if strings.Count(body, "data-queue-dispatch") != 3 || strings.Contains(body, "<select") || strings.Contains(body, `value="all"`) || strings.Contains(body, `aria-label="网站导航"`) {
        t.Fatal("队列页结构与原版三卡片布局存在差异")
    }
    if !strings.Contains(body, "border-emerald-600 bg-emerald-600") || !strings.Contains(body, "data-theme-icon") {
        t.Fatal("刷新按钮与独立主题图标样式缺失")
    }
    if _, err := time.Parse(time.RFC3339Nano, data.RequestedAt); err != nil {
        t.Fatal("请求结果缺少有效时间", err)
    }
}

func TestProjectRecordMatchesReferenceFields(t *testing.T) {
    at := float64(time.Date(2026, 10, 6, 1, 2, 3, 456000000, time.UTC).UnixMilli())
    for _, status := range []struct{ stored, public string }{
        {"waiting", "queued"}, {"delayed", "queued"}, {"active", "processing"}, {"completed", "completed"}, {"failed", "failed"},
    } {
        t.Run(status.stored, func(t *testing.T) {
            row := &records.Record{
                QueueName:       "default",
                JobID:           "reference-task",
                Status:          status.stored,
                Attempts:        2,
                ExecutionNumber: 7,
                ProcessedAt:     &at,
                Data:            map[string]any{"mode": "fail-once", "requestedAt": "2026-10-06T01:02:03.000Z"},
            }
            got := subject.ProjectRecord(row)
            if got.Status != status.public || got.Attempt != row.Attempts || got.Mode != "fail-once" || got.ProcessedAt != "2026-10-06T01:02:03.456Z" || got.RequestedAt != "2026-10-06T01:02:03.000Z" {
                t.Fatal(got)
            }
        })
    }

    empty := subject.ProjectRecord(&records.Record{})
    if empty.Mode != "-" || empty.RequestedAt != "-" || empty.ProcessedAt != "-" {
        t.Fatal(empty)
    }
}

// TestBusPage 保证匿名页可读、操作门禁及登录后账号字段安全转义。
func TestBusPage(t *testing.T) {
    for _, enabled := range []bool{false, true} {
        data := subject.BusPage(subject.Assets{})
        data.CanUseBus = enabled
        data.UserName = "<script>账号</script>"
        e := echo.New()
        w := httptest.NewRecorder()
        if err := subject.Render(e.NewContext(httptest.NewRequest(http.MethodGet, "/test/bus", nil), w), data, 200); err != nil {
            t.Fatal(err)
        }
        body := w.Body.String()
        for _, text := range []string{"Bus 消息总线演示", "REST + WebSocket", "REST + SSE + WebSocket", "demo:bus:broadcast", "demo:bus:query:requests", "data-bus-page", "开启 JavaScript"} {
            if !strings.Contains(body, text) {
                t.Fatal("Bus 页面缺少", text)
            }
        }
        if strings.Contains(body, "<script>账号</script>") {
            t.Fatal("账号名称未转义")
        }
        if enabled {
            if !strings.Contains(body, "&lt;script&gt;账号&lt;/script&gt;") || strings.Contains(body, "<fieldset disabled") {
                t.Fatal("登录账号操作状态无效")
            }
        } else if !strings.Contains(body, "<fieldset disabled") || !strings.Contains(body, "/admin/login?returnTo=%2Ftest%2Fbus") {
            t.Fatal("匿名页操作门禁无效")
        }
    }
}

// TestBusPageKeepsReferenceStructure 固定 Astro 参考页的视觉结构与增强入口。
func TestBusPageKeepsReferenceStructure(t *testing.T) {
    data := subject.BusPage(subject.Assets{})
    data.CanUseBus = true
    e := echo.New()
    w := httptest.NewRecorder()
    if err := subject.Render(e.NewContext(httptest.NewRequest(http.MethodGet, "/test/bus", nil), w), data, http.StatusOK); err != nil {
        t.Fatal(err)
    }
    body := w.Body.String()
    for _, marker := range []string{
        `data-public-page="bus"`, "Message Bus · Live Demo", "Bus 消息总线演示",
        `class="border-b" role="tablist"`, "aria-selected:border-primary", "发布消息，实时接收",
        "订阅连接", "发布到 Bus", "设备连接（Websocket）", "用户查询（REST + SSE）",
        "data-device-clear", "data-log-empty", `id="broadcast-topic-flow"`, `id="query-topic-flow"`,
        "sm:grid-cols-3", "lg:grid-cols-4", "查询命令 · 固定 topic", "设备回执 · 每次查询独立的 topic",
    } {
        if !strings.Contains(body, marker) {
            t.Fatalf("Bus 参考结构缺少 %s", marker)
        }
    }
    if strings.Contains(body, `aria-selected:bg-primary`) || strings.Contains(body, `href="/test/websocket"`) {
        t.Fatal("Bus 页面保留了旧 Tab 或引用了应用外的路由")
    }
}
