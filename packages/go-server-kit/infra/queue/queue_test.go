package queue_test

// 本文件覆盖Redis 队列隔离、任务投递及消费。

import (
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/internal/testredis"
    "context"
    "errors"
    "github.com/hibiken/asynq"
    "os"
    "testing"
    "time"
)

func TestQueueRedis(t *testing.T) {
    _, prefix := testredis.Open(t)
    ctx := context.Background()
    c := subject.Config{
        RedisURL:        os.Getenv("REDIS_TEST_URL"),
        Namespace:       prefix,
        Instance:        "worker",
        Concurrency:     1,
        ShutdownTimeout: time.Second,
    }
    r, opt, err := subject.Open(c)
    if err != nil {
        t.Fatal(err)
    }
    defer r.Close()
    client := asynq.NewClient(opt)
    defer client.Close()
    inspector := asynq.NewInspector(opt)
    defer inspector.Close()
    delivered := make(chan string, 2)
    mux := asynq.NewServeMux()
    mux.HandleFunc("test:ok", func(ctx context.Context, t *asynq.Task) error {
        delivered <- string(t.Payload())
        return nil
    })
    mux.HandleFunc("test:invalid", func(ctx context.Context, t *asynq.Task) error { return asynq.SkipRetry })
    mux.HandleFunc("test:retry", func(ctx context.Context, t *asynq.Task) error { return errors.New("受控重试") })
    info, err := subject.Enqueue(ctx, client, c, "default", "test:ok", map[string]int{"n": 42}, subject.TaskID("ok"), 1, 5*time.Second)
    if err != nil {
        t.Fatal(err)
    }
    if info.Retention != 7*24*time.Hour {
        t.Fatal("成功原任务保留期", info.Retention)
    }
    if _, err = subject.Enqueue(ctx, client, c, "default", "test:ok", nil, info.ID, 1, time.Second); !errors.Is(err, asynq.ErrTaskIDConflict) {
        t.Fatal("重复任务冲突", err)
    }
    // 隔离命名空间的任务保持 pending。
    other := c
    other.Namespace = prefix + "-other"
    isolated, err := subject.Enqueue(ctx, client, other, "default", "test:ok", nil, subject.TaskID("other"), 1, time.Second)
    if err != nil {
        t.Fatal(err)
    }

    worker, err := subject.NewServer(c, opt, mux)
    if err != nil {
        t.Fatal(err)
    }
    defer worker.Shutdown()
    select {
    case got := <-delivered:
        if got != "{\"n\":42}" {
            t.Fatal(got)
        }
    case <-time.After(8 * time.Second):
        t.Fatal("消费超时")
    }

    testredis.Wait(t, func() bool {
        v, e := inspector.GetTaskInfo(info.Queue, info.ID)
        return e == nil && v.State == asynq.TaskStateCompleted
    })
    if _, err = subject.Enqueue(ctx, client, c, "default", "test:ok", nil, info.ID, 1, time.Second); !errors.Is(err, asynq.ErrTaskIDConflict) {
        t.Fatal("完成任务保留期间冲突", err)
    }

    invalid, err := subject.Enqueue(ctx, client, c, "default", "test:invalid", nil, subject.TaskID("invalid"), 3, time.Second)
    if err != nil {
        t.Fatal(err)
    }

    retry, err := subject.Enqueue(ctx, client, c, "default", "test:retry", nil, subject.TaskID("retry"), 3, time.Second)
    if err != nil {
        t.Fatal(err)
    }
    testredis.Wait(t, func() bool {
        v, e := inspector.GetTaskInfo(invalid.Queue, invalid.ID)
        return e == nil && v.State == asynq.TaskStateArchived
    })
    testredis.Wait(t, func() bool {
        v, e := inspector.GetTaskInfo(retry.Queue, retry.ID)
        return e == nil && v.State == asynq.TaskStateRetry && v.Retried == 1
    })
    if v, e := inspector.GetTaskInfo(isolated.Queue, isolated.ID); e != nil || v.State != asynq.TaskStatePending {
        t.Fatal("隔离队列", v, e)
    }

    cancelled, cancel := context.WithCancel(ctx)
    cancel()
    if _, err := subject.Enqueue(cancelled, client, c, "default", "test:ok", nil, subject.TaskID("cancel"), 1, time.Second); err == nil {
        t.Fatal("取消应传递")
    }
}
