package queue

// 本文件覆盖历史脱敏、保留期、人工重试预留及失败恢复、Asynq 执行记录和中断收敛。

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "os"
    "strings"
    "sync"
    "sync/atomic"
    "testing"
    "time"

    infra "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/internal/testredis"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "github.com/google/uuid"
    "github.com/hibiken/asynq"
    "github.com/redis/go-redis/v9"
)

type memoryInspector struct {
    mu       sync.Mutex
    tasks    map[string]*asynq.TaskInfo
    runError bool
}

func (i *memoryInspector) GetTaskInfo(queue, id string) (*asynq.TaskInfo, error) {
    i.mu.Lock()
    defer i.mu.Unlock()
    r := i.tasks[queue+id]
    if r == nil {
        return nil, asynq.ErrTaskNotFound
    }

    copy := *r
    return &copy, nil
}

func (i *memoryInspector) Queues() ([]string, error) { return []string{}, nil }

func (i *memoryInspector) GetQueueInfo(queue string) (*asynq.QueueInfo, error) {
    return &asynq.QueueInfo{Queue: queue}, nil
}

func (i *memoryInspector) RunTask(queue, id string) error {
    i.mu.Lock()
    defer i.mu.Unlock()
    if i.runError {
        return errors.New("password=internal-redis-secret")
    }

    r := i.tasks[queue+id]
    if r == nil {
        return asynq.ErrTaskNotFound
    }
    if r.State != asynq.TaskStateArchived {
        return errors.New("状态变化")
    }

    r.State = asynq.TaskStatePending
    return nil
}

func redisService(t *testing.T, inspector Inspector) (*Service, infra.Config, asynq.RedisClientOpt) {
    t.Helper()
    _, namespace := testredis.Open(t)
    c := infra.Config{
        RedisURL:        os.Getenv("REDIS_TEST_URL"),
        Namespace:       namespace,
        Instance:        "worker",
        Concurrency:     1,
        ShutdownTimeout: time.Second,
    }
    r, opt, err := infra.Open(c)
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() {
        ctx := context.Background()
        var cursor uint64
        for {
            keys, next, e := r.Scan(ctx, cursor, "*"+namespace+"*", 100).Result()
            if e != nil {
                break
            }
            if len(keys) > 0 {
                _ = r.Del(ctx, keys...).Err()
            }

            cursor = next
            if cursor == 0 {
                break
            }
        }

        _ = r.Close()
    })
    s, err := New(r, inspector, c, 30*24*time.Hour)
    if err != nil {
        t.Fatal(err)
    }
    return s, c, opt
}

func seed(t *testing.T, s *Service, job, typ, queue, status string, at time.Time) *Record {
    t.Helper()
    r := s.template(&asynq.TaskInfo{
        ID:      job,
        Queue:   s.config.Queue(queue),
        Type:    typ,
        Payload: []byte(`{"password":"sensitive-value","nested":{"access_token":"nested-secret"},"normal":"ok"}`),
        State:   asynq.TaskStateArchived,
    })
    r = nextRecord(r, map[string]string{}, at)
    r.QueuedAt = number(milliseconds(at))
    r.Status = status
    r.State = status
    r.StatusHint = status
    if status == "failed" || status == "completed" {
        r.ProcessedAt = number(milliseconds(at))
        r.FinishedAt = number(milliseconds(at))
        r.RuntimeMs = number(0)
    }

    _, err := s.redis.TxPipelined(context.Background(), func(p redis.Pipeliner) error {
        s.save(context.Background(), p, r, "")
        p.HSet(context.Background(), s.taskKey(r), "latest", r.ID, "sequence", 1)
        return nil
    })
    if err != nil {
        t.Fatal(err)
    }
    return r
}

func expectCode(t *testing.T, err error, code string) {
    t.Helper()
    var e *httperr.Error
    if !errors.As(err, &e) || e.Code != code {
        t.Fatalf("期望 %s，得到 %v", code, err)
    }
}

func TestRedaction(t *testing.T) {
    s := &Service{}
    r := &Record{
        Data: map[string]any{
            "password": "sensitive-value",
            "nested":   []any{map[string]any{"access_token": "nested-secret", "normal": "保留"}},
            "Cookie":   "sid=cookie-secret",
        },
        ReturnValue:  map[string]any{"api_key": "output-secret", "echo": "sensitive-value"},
        FailedReason: "sensitive-value nested-secret output-secret password=another-secret Bearer abcdefg eyJhbGci.abc.def",
        Stacktrace: []string{
            "cookie=stack-secret",
            `password="multi word secret"`,
            "Cookie: sid=header-secret; auth=header-token",
            "Authorization: custom header credential",
            "redis://operator:url-password@redis:6379/0",
        },
    }
    projected := s.project(r)
    body, _ := json.Marshal(projected)
    for _, secret := range []string{
        "sensitive-value",
        "nested-secret",
        "output-secret",
        "cookie-secret",
        "another-secret",
        "abcdefg",
        "eyJhbGci.abc.def",
        "stack-secret",
        "multi word secret",
        "header-secret",
        "header-token",
        "custom header credential",
        "url-password",
    } {
        if strings.Contains(string(body), secret) {
            t.Fatalf("安全投影泄漏 %s: %s", secret, body)
        }
    }

    if !strings.Contains(string(body), "保留") || r.Data.(map[string]any)["password"] != "sensitive-value" {
        t.Fatal("原始快照或常规字段变化")
    }

    structured := redact(`{"Password":"json-secret","items":[{"privateKey":"private-secret"}]}`, nil).(string)
    if strings.Contains(structured, "json-secret") || strings.Contains(structured, "private-secret") {
        t.Fatal(structured)
    }
}

func TestRecordsFilterPaginationRetention(t *testing.T) {
    inspector := &memoryInspector{tasks: map[string]*asynq.TaskInfo{}}
    s, _, _ := redisService(t, inspector)
    now := time.Now().Truncate(time.Millisecond)
    s.now = func() time.Time { return now }
    records := []*Record{}
    for i := 0; i < 25; i++ {
        records = append(records, seed(t, s, fmt.Sprint(i), "type:a", "default", "failed", now))
    }

    seed(t, s, "other", "type:b", "low", "completed", now.Add(-time.Hour))
    all, err := s.List(context.Background(), ListQuery{
        Status:    "failed",
        QueueName: "default",
        JobName:   "type:a",
        Limit:     20,
    })
    if err != nil || all.Total != 25 || len(all.Records) != 20 {
        t.Fatalf("%+v %v", all, err)
    }

    for i := 1; i < len(all.Records); i++ {
        if all.Records[i-1].ID < all.Records[i].ID {
            t.Fatal("同时间 ID 倒序不稳定")
        }
    }

    next, err := s.List(context.Background(), ListQuery{
        Status:    "failed",
        QueueName: "default",
        JobName:   "type:a",
        Limit:     20,
        Offset:    20,
    })
    if err != nil || len(next.Records) != 5 {
        t.Fatal(next, err)
    }

    raw, _ := json.Marshal(all)
    if strings.Contains(string(raw), "sensitive-value") || strings.Contains(string(raw), "nested-secret") {
        t.Fatal("列表泄漏原始参数")
    }

    filtered, err := s.List(context.Background(), ListQuery{
        Status: "all",
        From:   number(milliseconds(now.Add(-30 * time.Minute))),
        To:     number(milliseconds(now)),
    })
    if err != nil || filtered.Total != 25 {
        t.Fatal(filtered, err)
    }

    for _, q := range []ListQuery{
        {Limit: 1},
        {Limit: 101},
        {Offset: -1},
        {Status: "wrong"},
        {QueueName: "other"},
        {From: number(2), To: number(1)},
    } {
        _, err = s.List(context.Background(), q)
        expectCode(t, err, "BAD_USER_INPUT")
    }

    active := records[0]
    inspector.tasks[active.PhysicalQueueName+active.JobID] = &asynq.TaskInfo{State: asynq.TaskStateRetry}
    s.now = func() time.Time { return now.Add(31 * 24 * time.Hour) }
    removed, err := s.Cleanup(context.Background())
    if err != nil || removed != 25 {
        t.Fatalf("清理 %d %v", removed, err)
    }
    if _, err = s.raw(context.Background(), active.ID); err != nil {
        t.Fatal("活动重试链过早清理", err)
    }
    delete(inspector.tasks, active.PhysicalQueueName+active.JobID)
    s.now = func() time.Time { return now.Add(62 * 24 * time.Hour) }
    removed, err = s.Cleanup(context.Background())
    if err != nil || removed != 1 {
        t.Fatal(removed, err)
    }

    all, err = s.List(context.Background(), ListQuery{Status: "all"})
    if err != nil || all.Total != 0 {
        t.Fatal("清理后索引残留", all, err)
    }
}

func TestManualRetryReservationAndAudit(t *testing.T) {
    inspector := &memoryInspector{tasks: map[string]*asynq.TaskInfo{}}
    s, _, _ := redisService(t, inspector)
    ctx := context.Background()
    original := seed(t, s, "task-original", "type:a", "default", "failed", time.Now())
    inspector.tasks[original.PhysicalQueueName+original.JobID] = &asynq.TaskInfo{
        ID:       original.JobID,
        Queue:    original.PhysicalQueueName,
        Type:     original.JobName,
        Payload:  []byte(`{"password":"sensitive-value"}`),
        State:    asynq.TaskStateArchived,
        MaxRetry: 3,
    }
    detail, err := s.Get(ctx, original.ID)
    if err != nil || !detail.CanRetry {
        t.Fatal(detail, err)
    }

    start := make(chan struct{})
    var wins atomic.Int32
    var wg sync.WaitGroup
    for range 12 {
        wg.Add(1)
        go func() {
            defer wg.Done()
            <-start
            _, e := s.Retry(ctx, original.ID, "7", "操作人")
            if e == nil {
                wins.Add(1)
            }
        }()
    }

    close(start)
    wg.Wait()
    if wins.Load() != 1 {
        t.Fatalf("有效重试安排 %d", wins.Load())
    }

    records, err := s.List(ctx, ListQuery{Status: "all"})
    if err != nil || records.Total != 2 {
        t.Fatal(records, err)
    }

    latest, err := s.Get(ctx, records.Records[0].ID)
    if err != nil || latest.ExecutionNumber != 2 || latest.JobID != original.JobID || latest.RetryOfRecordID == nil || *latest.RetryOfRecordID != original.ID {
        t.Fatal(latest, err)
    }

    historical, err := s.Get(ctx, original.ID)
    if err != nil || historical.CanRetry || historical.LatestRecordID != latest.ID {
        t.Fatal(historical, err)
    }

    auditIDs, err := s.redis.SMembers(ctx, s.key("audits:"+taskToken(original.PhysicalQueueName, original.JobID))).Result()
    if err != nil || len(auditIDs) != 12 {
        t.Fatal(auditIDs, err)
    }

    successes := 0
    for _, id := range auditIDs {
        body, _ := s.redis.Get(ctx, s.key("audit:"+id)).Bytes()
        var a Audit
        _ = json.Unmarshal(body, &a)
        if a.Outcome == "success" {
            successes++
            if a.ActorID != "7" || a.ActorName != "操作人" || a.RecordID != original.ID || a.NewRecordID != latest.ID {
                t.Fatal(a)
            }
        }
    }

    if successes != 1 {
        t.Fatal(successes)
    }
    inspector.mu.Lock()
    delete(inspector.tasks, original.PhysicalQueueName+original.JobID)
    inspector.mu.Unlock()
    historical, err = s.Get(ctx, original.ID)
    if err != nil || historical.CurrentJobState != "missing" || historical.CanRetry {
        t.Fatal(historical, err)
    }

    _, err = s.Retry(ctx, original.ID, "7", "操作人")
    expectCode(t, err, "CONFLICT")
}

func TestRetryFailureRollbackAndRecovery(t *testing.T) {
    inspector := &memoryInspector{tasks: map[string]*asynq.TaskInfo{}, runError: true}
    s, _, _ := redisService(t, inspector)
    ctx := context.Background()
    original := seed(t, s, "task-fail", "type:a", "default", "failed", time.Now())
    inspector.tasks[original.PhysicalQueueName+original.JobID] = &asynq.TaskInfo{
        ID:      original.JobID,
        Queue:   original.PhysicalQueueName,
        Type:    original.JobName,
        Payload: []byte(`{}`),
        State:   asynq.TaskStateArchived,
    }
    _, err := s.Retry(ctx, original.ID, "8", "操作人")
    expectCode(t, err, "SERVICE_UNAVAILABLE")
    detail, err := s.Get(ctx, original.ID)
    if err != nil || !detail.CanRetry {
        t.Fatal(detail, err)
    }

    records, err := s.List(ctx, ListQuery{Status: "all"})
    if err != nil || records.Total != 1 {
        t.Fatal(records, err)
    }

    audits, _ := s.redis.SMembers(ctx, s.key("audits:"+taskToken(original.PhysicalQueueName, original.JobID))).Result()
    for _, id := range audits {
        body, _ := s.redis.Get(ctx, s.key("audit:"+id)).Result()
        if strings.Contains(body, "internal-redis-secret") {
            t.Fatal("审计泄漏内部错误")
        }
    }
    // 模拟恢复前任务进入 retry，补记宕机执行的失败。
    active := seed(t, s, "interrupted", "type:b", "low", "active", time.Now().Add(-time.Hour))
    active.ProcessedAt = number(milliseconds(time.Now().Add(-time.Hour)))
    _, _ = s.redis.TxPipelined(ctx, func(p redis.Pipeliner) error {
        s.save(ctx, p, active, "")
        return nil
    })
    inspector.tasks[active.PhysicalQueueName+active.JobID] = &asynq.TaskInfo{State: asynq.TaskStateRetry, LastErr: "password=sensitive-value"}
    now := time.Now().Add(3 * time.Minute)
    s.now = func() time.Time { return now }
    if err = s.Reconcile(ctx); err != nil {
        t.Fatal(err)
    }

    got, err := s.Get(ctx, active.ID)
    if err != nil || got.State != "failed" || got.CanRetry || strings.Contains(got.FailedReason, "sensitive-value") {
        t.Fatal(got, err)
    }
}

func TestAsynqExecutionHistory(t *testing.T) {
    // 正式 Asynq Worker 覆盖自动重试与提前归档后的单次人工执行。
    _, namespace := testredis.Open(t)
    c := infra.Config{
        RedisURL:        os.Getenv("REDIS_TEST_URL"),
        Namespace:       namespace,
        Instance:        "worker",
        Concurrency:     1,
        ShutdownTimeout: time.Second,
    }
    r, opt, err := infra.Open(c)
    if err != nil {
        t.Fatal(err)
    }
    defer r.Close()
    inspector := asynq.NewInspector(opt)
    defer inspector.Close()
    client := asynq.NewClient(opt)
    defer client.Close()
    s, err := New(r, inspector, c, 30*24*time.Hour)
    if err != nil {
        t.Fatal(err)
    }

    c.Observer = s
    defer func() {
        ctx := context.Background()
        keys, _ := r.Keys(ctx, "*"+namespace+"*").Result()
        if len(keys) > 0 {
            _ = r.Del(ctx, keys...).Err()
        }
    }()
    var autoCalls, manualCalls atomic.Int32
    mux := asynq.NewServeMux()
    mux.HandleFunc("test:auto", func(ctx context.Context, t *asynq.Task) error {
        if autoCalls.Add(1) < 3 {
            return errors.New("password=auto-secret")
        }

        _, e := t.ResultWriter().Write([]byte(`{"password":"result-secret","ok":true}`))
        return e
    })
    mux.HandleFunc("test:manual", func(ctx context.Context, t *asynq.Task) error {
        if manualCalls.Add(1) == 1 {
            return errors.Join(errors.New("password=manual-secret"), asynq.SkipRetry)
        }
        return errors.New("password=manual-secret")
    })
    server := asynq.NewServer(opt, asynq.Config{
        Concurrency:              1,
        Queues:                   map[string]int{c.Queue("default"): 1},
        TaskCheckInterval:        20 * time.Millisecond,
        DelayedTaskCheckInterval: 50 * time.Millisecond,
        ShutdownTimeout:          time.Second,
        RetryDelayFunc:           func(int, error, *asynq.Task) time.Duration { return 50 * time.Millisecond },
    })
    if err = server.Start(s.Wrap(mux)); err != nil {
        t.Fatal(err)
    }
    defer server.Shutdown()
    ctx := context.Background()
    auto, err := infra.Enqueue(ctx, client, c, "default", "test:auto", map[string]string{"password": "auto-secret"}, uuid.NewString(), 2, time.Second)
    if err != nil {
        t.Fatal(err)
    }
    testredis.Wait(t, func() bool {
        info, e := inspector.GetTaskInfo(auto.Queue, auto.ID)
        return e == nil && info.State == asynq.TaskStateCompleted
    })
    records, err := s.List(ctx, ListQuery{Status: "all", JobName: "test:auto"})
    if err != nil || records.Total != 3 || autoCalls.Load() != 3 {
        t.Fatal(records, err, autoCalls.Load())
    }

    for i, r := range records.Records {
        if r.ExecutionNumber != 3-i || r.JobID != auto.ID {
            t.Fatal(r)
        }
    }

    latest, err := s.Get(ctx, records.Records[0].ID)
    if err != nil {
        t.Fatal(err)
    }

    body, _ := json.Marshal(latest)
    if strings.Contains(string(body), "result-secret") || latest.ReturnValue.(map[string]any)["ok"] != true {
        t.Fatal(string(body))
    }

    manual, err := infra.Enqueue(ctx, client, c, "default", "test:manual", map[string]string{"password": "manual-secret"}, uuid.NewString(), 5, time.Second)
    if err != nil {
        t.Fatal(err)
    }
    testredis.Wait(t, func() bool {
        info, e := inspector.GetTaskInfo(manual.Queue, manual.ID)
        return e == nil && info.State == asynq.TaskStateArchived
    })
    records, err = s.List(ctx, ListQuery{Status: "failed", JobName: "test:manual"})
    if err != nil || records.Total != 1 {
        t.Fatal(records, err)
    }

    previous := records.Records[0].ID
    retried, err := s.Retry(ctx, previous, "7", "管理员")
    if err != nil {
        t.Fatal(err)
    }
    testredis.Wait(t, func() bool {
        info, e := inspector.GetTaskInfo(manual.Queue, manual.ID)
        return e == nil && info.State == asynq.TaskStateArchived && manualCalls.Load() == 2
    })
    time.Sleep(300 * time.Millisecond)
    if manualCalls.Load() != 2 {
        t.Fatal("人工失败继续自动执行", manualCalls.Load())
    }

    records, err = s.List(ctx, ListQuery{Status: "failed", JobName: "test:manual"})
    if err != nil || records.Total != 2 {
        t.Fatal(records, err)
    }

    detail, err := s.Get(ctx, retried.ID)
    if err != nil || !detail.CanRetry || detail.ExecutionNumber != 2 {
        t.Fatal(detail, err)
    }

    _, err = s.Retry(ctx, previous, "7", "管理员")
    expectCode(t, err, "CONFLICT")
    retriedAgain, err := s.Retry(ctx, retried.ID, "7", "管理员")
    if err != nil || retriedAgain.ExecutionNumber != 3 {
        t.Fatal(retriedAgain, err)
    }
    testredis.Wait(t, func() bool {
        info, e := inspector.GetTaskInfo(manual.Queue, manual.ID)
        return e == nil && info.State == asynq.TaskStateArchived && manualCalls.Load() == 3
    })
    dashboard, err := s.Dashboard(ctx)
    if err != nil || dashboard.Overview.Failed != 1 || dashboard.Overview.SucceededExecutions24h != 1 || dashboard.Overview.FailedExecutions24h != 5 {
        t.Fatal(dashboard, err)
    }
    if err = inspector.DeleteTask(manual.Queue, manual.ID); err != nil {
        t.Fatal(err)
    }

    detail, err = s.Get(ctx, retriedAgain.ID)
    if err != nil || detail.CanRetry || detail.CurrentJobState != "missing" {
        t.Fatal(detail, err)
    }
}

// 长期排队记录轮转后，下一批中断任务继续获得复核机会。
func TestReconcileRotationAndSchedulingAudit(t *testing.T) {
    inspector := &memoryInspector{tasks: map[string]*asynq.TaskInfo{}}
    s, _, _ := redisService(t, inspector)
    ctx := context.Background()
    now := time.Now().Truncate(time.Millisecond)
    s.now = func() time.Time { return now }
    for i := 0; i < 100; i++ {
        r := seed(t, s, fmt.Sprintf("waiting-%d", i), "type:a", "default", "waiting", now)
        inspector.tasks[r.PhysicalQueueName+r.JobID] = &asynq.TaskInfo{State: asynq.TaskStatePending}
    }

    now = now.Add(time.Second)
    active := seed(t, s, "later-active", "type:b", "low", "active", now)
    active.ProcessedAt = number(milliseconds(now))
    audit := &Audit{
        ID:          uuid.NewString(),
        RecordID:    active.ID,
        NewRecordID: active.ID,
        Outcome:     "scheduling",
    }
    _, err := s.redis.TxPipelined(ctx, func(p redis.Pipeliner) error {
        s.save(ctx, p, active, "")
        s.saveAudit(ctx, p, active, audit)
        p.HSet(ctx, s.taskKey(active), "audit", audit.ID)
        return nil
    })
    if err != nil {
        t.Fatal(err)
    }

    inspector.tasks[active.PhysicalQueueName+active.JobID] = &asynq.TaskInfo{State: asynq.TaskStateRetry}
    now = now.Add(3 * time.Minute)
    for range 2 {
        if err = s.Reconcile(ctx); err != nil {
            t.Fatal(err)
        }
    }

    got, err := s.raw(ctx, active.ID)
    if err != nil || got.Status != "failed" {
        t.Fatal(got, err)
    }

    body, err := s.redis.Get(ctx, s.key("audit:"+audit.ID)).Bytes()
    if err != nil || json.Unmarshal(body, audit) != nil || audit.Outcome != "success" {
        t.Fatal(string(body), err)
    }
    if count := s.redis.ZCard(ctx, s.key("reconcile")).Val(); count != 100 {
        t.Fatal(count)
    }
}

func TestRecordOutageArchivesBeforeBusinessExecution(t *testing.T) {
    inspector := &memoryInspector{tasks: map[string]*asynq.TaskInfo{}}
    s, _, _ := redisService(t, inspector)
    called := false
    handler := s.Wrap(asynq.HandlerFunc(func(ctx context.Context, task *asynq.Task) error {
        called = true
        return nil
    }))
    err := handler.ProcessTask(context.Background(), asynq.NewTask("type:a", nil))
    if called || !errors.Is(err, asynq.SkipRetry) {
        t.Fatal(called, err)
    }

    closed := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
    _ = closed.Close()
    s.redis = closed
    _, err = s.Retry(context.Background(), uuid.NewString(), "1", "管理员")
    expectCode(t, err, "SERVICE_UNAVAILABLE")
}

// 维护先补记中断时，随后真正恢复执行仍沿用人工单次标记。
func TestManualInterruptedRecoveryPreservesSingleAttempt(t *testing.T) {
    s, config, opt := redisService(t, &memoryInspector{tasks: map[string]*asynq.TaskInfo{}})
    inspector := asynq.NewInspector(opt)
    defer inspector.Close()
    s.inspector = inspector
    client := asynq.NewClient(opt)
    defer client.Close()
    ctx := context.Background()
    info, err := infra.Enqueue(ctx, client, config, "default", "test:manual-recovered", map[string]string{"value": "ok"}, uuid.NewString(), 3, time.Second)
    if err != nil {
        t.Fatal(err)
    }

    now := time.Now()
    original := seed(t, s, info.ID, info.Type, "default", "active", now.Add(-time.Hour))
    original.Manual = true
    original.ProcessedAt = number(milliseconds(now.Add(-time.Hour)))
    if _, err = s.redis.TxPipelined(ctx, func(p redis.Pipeliner) error {
        s.save(ctx, p, original, "")
        return nil
    }); err != nil {
        t.Fatal(err)
    }

    s.now = func() time.Time { return now.Add(3 * time.Minute) }
    if err = s.Reconcile(ctx); err != nil {
        t.Fatal(err)
    }

    ended, err := s.raw(ctx, original.ID)
    if err != nil || ended.Status != "failed" || !ended.Interrupted {
        t.Fatal(ended, err)
    }

    s.now = time.Now
    var calls atomic.Int32
    server := asynq.NewServer(opt, asynq.Config{
        Concurrency:              1,
        Queues:                   map[string]int{config.Queue("default"): 1},
        TaskCheckInterval:        20 * time.Millisecond,
        DelayedTaskCheckInterval: 50 * time.Millisecond,
        ShutdownTimeout:          time.Second,
        RetryDelayFunc:           func(int, error, *asynq.Task) time.Duration { return 50 * time.Millisecond },
    })
    if err = server.Start(s.Wrap(asynq.HandlerFunc(func(context.Context, *asynq.Task) error {
        calls.Add(1)
        return errors.New("恢复后的人工执行失败")
    }))); err != nil {
        t.Fatal(err)
    }
    defer server.Shutdown()
    testredis.Wait(t, func() bool {
        current, e := inspector.GetTaskInfo(info.Queue, info.ID)
        return e == nil && current.State == asynq.TaskStateArchived
    })
    records, err := s.List(ctx, ListQuery{Status: "all"})
    if err != nil || records.Total != 2 || calls.Load() != 1 {
        t.Fatal(records, err, calls.Load())
    }
    // 维护使用模拟的未来结束时间，按执行序号识别恢复记录。
    recoveredID := ""
    for _, record := range records.Records {
        if record.ExecutionNumber == 2 {
            recoveredID = record.ID
        }
    }

    recovered, err := s.Get(ctx, recoveredID)
    if err != nil || !recovered.Manual || recovered.Interrupted || recovered.ExecutionNumber != 2 || recovered.RetryOfRecordID == nil || *recovered.RetryOfRecordID != original.ID || !recovered.CanRetry {
        t.Fatal(recovered, err)
    }
}
