package tasks_test

// 本文件覆盖演示任务载荷边界、Worker 执行与 Redis 人工重试。

import (
    "context"
    "encoding/json"
    "errors"
    "os"
    "testing"
    "time"

    infra "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    records "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/queue"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/tasks"
    "github.com/google/uuid"
    "github.com/hibiken/asynq"
)

func TestQueueTestPayloadValidation(t *testing.T) {
    base := subject.QueueTestPayload{
        Queue:       "default",
        Mode:        "success",
        RequestedAt: time.Now().UTC().Format(time.RFC3339Nano),
        Source:      "queue-test-page",
    }
    for _, queue := range []string{"default", "critical", "low"} {
        for _, mode := range []string{"success", "fail-once", "always-fail"} {
            p := base
            p.Queue, p.Mode = queue, mode
            if err := p.Validate(); err != nil {
                t.Fatal(queue, mode, err)
            }
        }
    }

    for _, field := range []string{"queue", "mode", "time", "source"} {
        p := base
        switch field {
        case "queue":
            p.Queue = "invalid"
        case "mode":
            p.Mode = "invalid"
        case "time":
            p.RequestedAt = "invalid"
        case "source":
            p.Source = "invalid"
        }

        if p.Validate() == nil {
            t.Fatal("接受非法字段", field)
        }
    }

    service := subject.QueueTestService{}
    raw, _ := json.Marshal(base)
    if err := service.ProcessTask(context.Background(), asynq.NewTask(subject.QueueTestType, raw)); err != nil {
        t.Fatal(err)
    }

    base.Mode = "always-fail"
    raw, _ = json.Marshal(base)
    if err := service.ProcessTask(context.Background(), asynq.NewTask(subject.QueueTestType, raw)); !errors.Is(err, asynq.SkipRetry) {
        t.Fatal(err)
    }
    if err := service.ProcessTask(context.Background(), asynq.NewTask(subject.QueueTestType, []byte("{}"))); !errors.Is(err, asynq.SkipRetry) {
        t.Fatal(err)
    }
    if _, err := service.Enqueue(context.Background(), "invalid", "success"); err == nil {
        t.Fatal("非法投递参数触发队列调用")
    }
}

func TestQueueTestWorkerAndManualRetryRedis(t *testing.T) {
    if os.Getenv("REDIS_TEST_URL") == "" {
        t.Skip("需要隔离 REDIS_TEST_URL")
    }

    ctx := context.Background()
    config := infra.Config{
        RedisURL:        os.Getenv("REDIS_TEST_URL"),
        Namespace:       "ssr-test-" + uuid.NewString(),
        Instance:        "worker",
        Concurrency:     1,
        ShutdownTimeout: time.Second,
    }
    r, opt, err := infra.Open(config)
    if err != nil {
        t.Fatal(err)
    }
    defer r.Close()
    defer func() {
        keys, _ := r.Keys(ctx, "*"+config.Namespace+"*").Result()
        if len(keys) > 0 {
            _ = r.Del(ctx, keys...).Err()
        }
    }()
    inspector := asynq.NewInspector(opt)
    defer inspector.Close()
    client := asynq.NewClient(opt)
    defer client.Close()
    store, err := records.New(r, inspector, config, 24*time.Hour)
    if err != nil {
        t.Fatal(err)
    }

    config.Observer = store
    service := subject.QueueTestService{Client: client, Redis: r, Config: config}
    mux := asynq.NewServeMux()
    mux.Handle(subject.QueueTestType, service)
    worker := asynq.NewServer(opt, asynq.Config{
        Concurrency: 1,
        Queues: map[string]int{
            config.Queue("critical"): 6,
            config.Queue("default"):  3,
            config.Queue("low"):      1,
        },
        TaskCheckInterval: 20 * time.Millisecond,
        ShutdownTimeout:   time.Second,
    })
    if err := worker.Start(store.Wrap(mux)); err != nil {
        t.Fatal(err)
    }
    defer worker.Shutdown()
    wait := func(info *asynq.TaskInfo, state asynq.TaskState) *records.Record {
        t.Helper()
        deadline := time.Now().Add(8 * time.Second)
        for time.Now().Before(deadline) {
            current, e := inspector.GetTaskInfo(info.Queue, info.ID)
            list, le := store.List(ctx, records.ListQuery{
                JobName:   subject.QueueTestType,
                QueueName: info.Queue[len(config.Namespace)+1:],
                Status:    "recent",
                Limit:     20,
            })
            if e == nil && le == nil && current.State == state {
                for _, row := range list.Records {
                    if row.JobID == info.ID && ((state == asynq.TaskStateCompleted && row.Status == "completed") || (state == asynq.TaskStateArchived && row.Status == "failed")) {
                        return row
                    }
                }
            }
            time.Sleep(20 * time.Millisecond)
        }

        t.Fatal("等待演示任务状态超时", info.ID, state)
        return nil
    }
    for _, queue := range []string{"critical", "default", "low"} {
        info, err := service.Enqueue(ctx, queue, "success")
        if err != nil {
            t.Fatal(err)
        }

        row := wait(info, asynq.TaskStateCompleted)
        if row.QueueName != queue || row.ExecutionNumber != 1 {
            t.Fatal(row)
        }
    }

    for _, mode := range []string{"fail-once", "always-fail"} {
        info, err := service.Enqueue(ctx, "default", mode)
        if err != nil {
            t.Fatal(err)
        }

        first := wait(info, asynq.TaskStateArchived)
        if first.ExecutionNumber != 1 {
            t.Fatal(first)
        }
        if _, err := store.Retry(ctx, first.ID, "1", "演示管理员"); err != nil {
            t.Fatal(err)
        }

        state := asynq.TaskStateCompleted
        if mode == "always-fail" {
            state = asynq.TaskStateArchived
        }

        deadline := time.Now().Add(8 * time.Second)
        for {
            second := wait(info, state)
            if second.ExecutionNumber == 2 {
                if second.RetryOfRecordID == nil || *second.RetryOfRecordID != first.ID {
                    t.Fatal("重试链未关联", second)
                }
                break
            }
            if time.Now().After(deadline) {
                t.Fatal("等待重试序号超时")
            }
            time.Sleep(20 * time.Millisecond)
        }
    }
}
