package server_test

// 本文件覆盖公开页路由及队列演示入口的读写授权。

import (
    "context"
    "errors"
    "net/http"
    "path/filepath"
    "reflect"
    "strings"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    records "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/tasks"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
    "github.com/hibiken/asynq"
)

type pageQueue struct {
    calls                   []string
    queries                 []records.ListQuery
    listError, enqueueError error
    failQueue               string
}

func (q *pageQueue) Enqueue(_ context.Context, queue, mode string) (*asynq.TaskInfo, error) {
    q.calls = append(q.calls, queue+":"+mode)
    if q.enqueueError != nil && (q.failQueue == "" || q.failQueue == queue) {
        return nil, q.enqueueError
    }
    return &asynq.TaskInfo{ID: "test-" + queue}, nil
}

func (q *pageQueue) List(_ context.Context, query records.ListQuery) (*records.RecordsPayload, error) {
    q.queries = append(q.queries, query)
    if q.listError != nil {
        return nil, q.listError
    }
    return &records.RecordsPayload{Records: []*records.Record{{
        JobID:           "server-rendered-task",
        QueueName:       "default",
        Status:          "completed",
        ExecutionNumber: 1,
        Data:            map[string]any{"mode": "success", "requestedAt": "2026-10-06T01:00:00Z"},
    }}}, nil
}

func TestPublicPageRoutesAndQueueAuthorization(t *testing.T) {
    ctx := context.Background()
    db, err := database.Open(ctx, "sqlite", filepath.Join(t.TempDir(), "pages.sqlite"))
    if err != nil {
        t.Fatal(err)
    }

    sql, _ := db.DB()
    defer sql.Close()
    if err := db.AutoMigrate(auth.Models()...); err != nil {
        t.Fatal(err)
    }

    policies := auth.DefaultRolePermissions()
    policies["reader"] = []auth.Permission{{Resource: "dashboard", Action: "access:admin"}, {Resource: "queue", Action: "read"}}
    policies["retry-only"] = []auth.Permission{{Resource: "dashboard", Action: "access:admin"}, {Resource: "queue", Action: "retry"}}
    for i, role := range []string{"owner", "reader", "member", "retry-only"} {
        user := auth.User{ID: i + 1, Name: role, Email: role + "@pages.test", Role: &role}
        if err := db.Create(&user).Error; err != nil {
            t.Fatal(err)
        }

        session := auth.Session{
            UserID:    user.ID,
            Token:     role + "-token",
            ExpiresAt: time.Now().Add(time.Hour),
        }
        if err := db.Create(&session).Error; err != nil {
            t.Fatal(err)
        }
    }

    authentication, err := auth.New(db, auth.Config{
        Secret:      "ssr-test-secret-at-least-32-bytes-long",
        Origins:     []string{"http://localhost"},
        Permissions: policies,
    })
    if err != nil {
        t.Fatal(err)
    }

    queue := &pageQueue{}
    api := subject.New(newMemory(), subject.Config{
        Authentication:   authentication,
        QueueTest:        queue,
        QueueTestRecords: queue,
    })
    api.Use(authentication.Guard)
    for _, path := range []string{"/", "/test/queue", "/public/theme.js"} {
        got := perform(api, "GET", path, "", nil)
        if got.Code != 200 {
            t.Fatal(path, got.Code, got.Body.String())
        }

        head := perform(api, "HEAD", path, "", nil)
        if head.Code != 200 || head.Body.Len() != 0 {
            t.Fatal(path, head.Code)
        }
    }

    if len(queue.queries) != 0 {
        t.Fatal("匿名页面读取了队列数据")
    }
    // 旧 action 参数只作为查询文本，GET 始终保持无副作用。
    got := perform(api, "GET", "/test/queue?action=default&mode=always-fail", "", nil)
    if got.Code != 200 || len(queue.calls) != 0 {
        t.Fatal("GET 触发任务投递")
    }

    for _, role := range []string{"owner", "reader", "member", "retry-only"} {
        headers := map[string]string{"Authorization": "Bearer " + role + "-token"}
        got := perform(api, "GET", "/test/queue", "", headers)
        want := 200
        if role == "member" || role == "retry-only" {
            want = 403
        }
        if got.Code != want {
            t.Fatal(role, got.Code, got.Body.String())
        }
        if want == 200 && !strings.Contains(got.Body.String(), "server-rendered-task") {
            t.Fatal("记录未在服务端输出")
        }
        if role == "reader" && !strings.Contains(got.Body.String(), "disabled") {
            t.Fatal("只读账号可投递任务")
        }

        posted := perform(api, "POST", subject.QueueTestPath, `{"queue":"default","mode":"success"}`, headers)
        postStatus := 403
        if role == "owner" {
            postStatus = 202
        }
        if posted.Code != postStatus {
            t.Fatal(role, posted.Code, posted.Body.String())
        }
    }

    for _, query := range queue.queries {
        if query.JobName != tasks.QueueTestType || query.Limit != 20 || query.Status != "recent" || query.OrderDirection != "desc" {
            t.Fatal(query)
        }
    }

    if !reflect.DeepEqual(queue.calls, []string{"default:success"}) {
        t.Fatal(queue.calls)
    }

    signed := authentication.Sign("owner-token")
    cookies := map[string]string{"Cookie": "better-auth.session_token=" + signed}
    if got := perform(api, "GET", "/test/queue", "", cookies); got.Code != 200 || !strings.Contains(got.Body.String(), "server-rendered-task") {
        t.Fatal(got.Code, got.Body.String())
    }

    body := `{"queue":"all","mode":"fail-once"}`
    if got := perform(api, "POST", subject.QueueTestPath, body, cookies); got.Code != 403 {
        t.Fatal("Cookie POST 来源门禁", got.Code)
    }

    cookies["Origin"] = "http://evil.test"
    if got := perform(api, "POST", subject.QueueTestPath, body, cookies); got.Code != 403 {
        t.Fatal("跨站 POST 门禁", got.Code)
    }

    cookies["Origin"] = "http://localhost"
    posted := perform(api, "POST", subject.QueueTestPath, body, cookies)
    if posted.Code != 202 || !strings.Contains(posted.Body.String(), "test-critical") || !strings.Contains(posted.Body.String(), "test-low") {
        t.Fatal(posted.Code, posted.Body.String())
    }

    before := len(queue.calls)
    for _, raw := range []string{
        `{}`,
        `{"queue":"invalid","mode":"success"}`,
        `{"queue":"default","mode":"invalid"}`,
        `{"queue":"default","mode":"success","extra":1}`,
        `{"queue":"default","mode":"success"} {}`,
        strings.Repeat(" ", 4097) + `{}`,
    } {
        if got := perform(api, "POST", subject.QueueTestPath, raw, cookies); got.Code != 400 {
            t.Fatal(raw[:min(len(raw), 50)], got.Code, got.Body.String())
        }
    }

    if len(queue.calls) != before {
        t.Fatal("非法参数触发投递")
    }
    if got := perform(api, "POST", subject.QueueTestPath, body, nil); got.Code != 401 {
        t.Fatal("匿名投递", got.Code)
    }
    if got := perform(api, "GET", subject.QueueTestPath, "", cookies); got.Code != http.StatusMethodNotAllowed {
        t.Fatal("投递方法门禁", got.Code)
    }

    queue.enqueueError = errors.New("redis://private-secret")
    queue.failQueue = "default"
    partial := perform(api, "POST", subject.QueueTestPath, body, cookies)
    if partial.Code != 202 || !strings.Contains(partial.Body.String(), "任务投递失败") || strings.Contains(partial.Body.String(), "private-secret") {
        t.Fatal(partial.Code, partial.Body.String())
    }

    queue.failQueue = ""
    failed := perform(api, "POST", subject.QueueTestPath, body, cookies)
    if failed.Code != 503 || strings.Contains(failed.Body.String(), "private-secret") {
        t.Fatal(failed.Code, failed.Body.String())
    }

    queue.listError = errors.New("private-secret")
    failed = perform(api, "GET", "/test/queue", "", cookies)
    if failed.Code != 503 || strings.Contains(failed.Body.String(), "private-secret") || !strings.Contains(failed.Body.String(), "执行记录读取失败") {
        t.Fatal(failed.Code, failed.Body.String())
    }

    queue.listError = nil
    if err := db.Model(&auth.Session{}).Where("token = ?", "owner-token").Update("expires_at", time.Now().Add(-time.Hour)).Error; err != nil {
        t.Fatal(err)
    }

    expired := perform(api, "GET", "/test/queue", "", cookies)
    if expired.Code != 200 || strings.Contains(expired.Body.String(), "server-rendered-task") {
        t.Fatal("过期会话仍显示记录")
    }
    if err := db.Model(&auth.User{}).Where("id = ?", 2).Update("banned", true).Error; err != nil {
        t.Fatal(err)
    }

    banned := perform(api, "GET", "/test/queue", "", map[string]string{"Authorization": "Bearer reader-token"})
    if banned.Code != 200 || strings.Contains(banned.Body.String(), "server-rendered-task") {
        t.Fatal("封禁账号仍显示记录")
    }
}
