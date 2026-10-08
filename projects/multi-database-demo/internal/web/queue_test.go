package server_test

// 本文件覆盖队列 GraphQL 查询与变更的权限边界。

import (
    "context"
    "encoding/json"
    "errors"
    "net/http"
    "os"
    "path/filepath"
    "strings"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    infra "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/schedule"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    records "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/queue"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
    "github.com/google/uuid"
    "github.com/hibiken/asynq"
)

func TestQueueGraphQLPermissions(t *testing.T) {
    if os.Getenv("REDIS_TEST_URL") == "" {
        t.Skip("需要隔离 REDIS_TEST_URL")
    }

    ctx := context.Background()
    cfg := infra.Config{
        RedisURL:        os.Getenv("REDIS_TEST_URL"),
        Namespace:       "queue-api-" + uuid.NewString(),
        Instance:        "test",
        Concurrency:     1,
        ShutdownTimeout: time.Second,
    }
    r, opt, err := infra.Open(cfg)
    if err != nil {
        t.Fatal(err)
    }
    defer r.Close()
    defer func() {
        keys, _ := r.Keys(ctx, "*"+cfg.Namespace+"*").Result()
        if len(keys) > 0 {
            _ = r.Del(ctx, keys...).Err()
        }
    }()
    inspector := asynq.NewInspector(opt)
    defer inspector.Close()
    client := asynq.NewClient(opt)
    defer client.Close()
    queue, err := records.New(r, inspector, cfg, 30*24*time.Hour, schedule.Definition{
        Name:       "api-tick",
        Expression: "@every 1m",
        Timezone:   "Asia/Shanghai",
        JobName:    "test:failure",
        QueueName:  "default",
    })
    if err != nil {
        t.Fatal(err)
    }

    cfg.Observer = queue
    mux := asynq.NewServeMux()
    mux.HandleFunc("test:failure", func(context.Context, *asynq.Task) error {
        return errors.Join(errors.New("password=queue-api-secret"), asynq.SkipRetry)
    })
    worker := asynq.NewServer(opt, asynq.Config{
        Concurrency:       1,
        Queues:            map[string]int{cfg.Queue("default"): 1},
        TaskCheckInterval: 20 * time.Millisecond,
        ShutdownTimeout:   time.Second,
    })
    if err = worker.Start(queue.Wrap(mux)); err != nil {
        t.Fatal(err)
    }
    defer worker.Shutdown()
    info, err := infra.Enqueue(ctx, client, cfg, "default", "test:failure", map[string]any{"password": "queue-api-secret", "keep": "公开字段"}, uuid.NewString(), 3, time.Second)
    if err != nil {
        t.Fatal(err)
    }

    deadline := time.Now().Add(8 * time.Second)
    for {
        current, e := inspector.GetTaskInfo(info.Queue, info.ID)
        if e == nil && current.State == asynq.TaskStateArchived {
            break
        }
        if time.Now().After(deadline) {
            t.Fatal("任务等待超时")
        }
        time.Sleep(20 * time.Millisecond)
    }

    list, err := queue.List(ctx, records.ListQuery{Status: "failed"})
    if err != nil || list.Total != 1 {
        t.Fatal(list, err)
    }

    recordID := list.Records[0].ID
    db, err := database.Open(ctx, "sqlite", filepath.Join(t.TempDir(), "queue.sqlite"))
    if err != nil {
        t.Fatal(err)
    }

    sql, _ := db.DB()
    defer sql.Close()
    if err = db.AutoMigrate(auth.Models()...); err != nil {
        t.Fatal(err)
    }
    if err = db.Create(&auth.Bootstrap{ID: 1}).Error; err != nil {
        t.Fatal(err)
    }

    policies := auth.DefaultRolePermissions()
    policies["reader"] = []auth.Permission{{Resource: "dashboard", Action: "access:admin"}, {Resource: "queue", Action: "read"}}
    policies["retry-only"] = []auth.Permission{{Resource: "dashboard", Action: "access:admin"}, {Resource: "queue", Action: "retry"}}
    tokens := map[string]string{}
    for i, role := range []string{"owner", "admin", "reader", "retry-only"} {
        u := auth.User{ID: i + 1, Name: role, Email: role + "@queue.test", Role: &role}
        if err = db.Create(&u).Error; err != nil {
            t.Fatal(err)
        }

        token := role + "-private-session"
        if err = db.Create(&auth.Session{UserID: u.ID, Token: token, ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
            t.Fatal(err)
        }

        tokens[role] = token
    }

    authentication, err := auth.New(db, auth.Config{
        Secret:      "test-secret-with-at-least-32-bytes",
        Permissions: policies,
        AdminPaths:  []string{subject.AdminPath},
    })
    if err != nil {
        t.Fatal(err)
    }

    api := subject.New(newMemory(), subject.Config{Authentication: authentication, Queue: queue})
    api.Use(authentication.Guard)
    request := func(actor, query string, variables map[string]any) map[string]any {
        t.Helper()
        raw, _ := json.Marshal(map[string]any{"query": query, "variables": variables})
        response := perform(api, http.MethodPost, subject.AdminPath, string(raw), map[string]string{"Authorization": "Bearer " + tokens[actor]})
        if response.Code != 200 {
            t.Fatalf("%d %s", response.Code, response.Body.String())
        }
        if strings.Contains(response.Body.String(), "queue-api-secret") || strings.Contains(response.Body.String(), "private-session") {
            t.Fatal("响应泄漏凭据", response.Body.String())
        }
        return decoded(t, response.Body.Bytes()).(map[string]any)
    }
    code := func(body map[string]any, want string) {
        t.Helper()
        errors, ok := body["errors"].([]any)
        if !ok || len(errors) == 0 || errors[0].(map[string]any)["extensions"].(map[string]any)["code"] != want {
            t.Fatal(body)
        }
    }
    overview := `{getQueueDashboard{capabilities{supportsRetry supportsWorkerPresence} overview{waiting active delayed retrying failed succeededExecutions24h failedExecutions24h} queues{queueName binding concurrency maxMemory workerProcessGroup workerProcessName} workerProcesses{name queues instances concurrency onlineInstances isOnline maxMemory memoryBytes} updatedAt}}`
    body := request("reader", overview, nil)
    if body["errors"] != nil {
        t.Fatal(body)
    }

    dashboard := body["data"].(map[string]any)["getQueueDashboard"].(map[string]any)
    if dashboard["capabilities"].(map[string]any)["supportsWorkerPresence"] != true {
        t.Fatal("在线观测能力", dashboard)
    }

    processes := dashboard["workerProcesses"].([]any)
    if len(processes) != 1 {
        t.Fatal("共享进程组", processes)
    }

    process := processes[0].(map[string]any)
    if process["name"] != cfg.Namespace+"-worker" || process["instances"] != nil || process["concurrency"] != float64(1) || process["onlineInstances"] != float64(1) || process["isOnline"] != true || process["memoryBytes"] != nil {
        t.Fatal("原生在线信息与空内存采样", process)
    }

    schedules := `{getQueueSchedules{scheduleCount schedulerInstanceCount schedulerLeader updatedAt schedules{name cron timezone jobName queueName enabled nextRunAt lastActivityAt status statusText} heartbeats{instanceId lastHeartbeatAt role}}}`
    body = request("reader", schedules, nil)
    if body["errors"] != nil || body["data"].(map[string]any)["getQueueSchedules"].(map[string]any)["scheduleCount"] != float64(1) {
        t.Fatal(body)
    }
    code(request("retry-only", schedules, nil), "FORBIDDEN")
    query := `query($id:String!){getQueueExecutionRecord(recordId:$id){id jobId name data failedReason state canRetry retryDisabledReason latestRecordId}}`
    body = request("reader", query, map[string]any{"id": recordID})
    if body["errors"] != nil || body["data"].(map[string]any)["getQueueExecutionRecord"].(map[string]any)["canRetry"] != false {
        t.Fatal(body)
    }

    body = request("admin", query, map[string]any{"id": recordID})
    if body["errors"] != nil || body["data"].(map[string]any)["getQueueExecutionRecord"].(map[string]any)["canRetry"] != true {
        t.Fatal(body)
    }

    mutation := `mutation($id:String!){updateQueueExecutionRecord(set:{recordId:$id}){noticeMessage detail{id jobId executionNumber retryOfRecordId}}}`
    code(request("reader", mutation, map[string]any{"id": recordID}), "FORBIDDEN")
    code(request("retry-only", mutation, map[string]any{"id": recordID}), "FORBIDDEN")
    code(request("retry-only", overview, nil), "FORBIDDEN")
    code(request("owner", `{listQueueExecutionRecords(status:"all",limit:0){total}}`, nil), "BAD_USER_INPUT")
    body = request("owner", `{listQueueExecutionRecords(status:"recent",orderBy:"updatedAt",orderDirection:"asc"){total isRecentPage records{id}}}`, nil)
    if body["errors"] != nil || body["data"].(map[string]any)["listQueueExecutionRecords"].(map[string]any)["total"] != float64(1) {
        t.Fatal(body)
    }
    code(request("owner", `{listQueueExecutionRecords(status:"recent",orderBy:"invalid"){total}}`, nil), "BAD_USER_INPUT")
    code(request("owner", `{listQueueExecutionRecords(status:"recent",orderDirection:"invalid"){total}}`, nil), "BAD_USER_INPUT")
    code(request("owner", query, map[string]any{"id": uuid.NewString()}), "NOT_FOUND")
    body = request("owner", mutation, map[string]any{"id": recordID})
    if body["errors"] != nil {
        t.Fatal(body)
    }

    result := body["data"].(map[string]any)["updateQueueExecutionRecord"].(map[string]any)
    detail := result["detail"].(map[string]any)
    if result["noticeMessage"] != "已安排重试" || detail["jobId"] != info.ID || detail["retryOfRecordId"] != recordID || detail["executionNumber"] != float64(2) {
        t.Fatal(result)
    }
    code(request("admin", mutation, map[string]any{"id": recordID}), "CONFLICT")
}
