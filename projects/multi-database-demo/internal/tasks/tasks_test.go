package tasks_test

// 本文件覆盖任务重复执行时 Redis 副作用的幂等性。

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/tasks"
    "context"
    "encoding/json"
    "errors"
    "github.com/google/uuid"
    "github.com/hibiken/asynq"
    "github.com/redis/go-redis/v9"
    "os"
    "sync"
    "testing"
)

func TestTaskIdempotencyRedis(t *testing.T) {
    url := os.Getenv("REDIS_TEST_URL")
    if url == "" {
        t.Skip("需要隔离 Redis")
    }

    opt, err := redis.ParseURL(url)
    if err != nil {
        t.Fatal(err)
    }

    r := redis.NewClient(opt)
    defer r.Close()
    c := queue.Config{Namespace: "task-test-" + uuid.NewString(), Instance: "a"}
    service := subject.Service{Redis: r, Config: c}
    raw, _ := json.Marshal(subject.Payload{Key: "idempotent"})
    task := asynq.NewTask(subject.Type, raw)
    var wg sync.WaitGroup
    errs := make(chan error, 8)
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            errs <- service.ProcessTask(context.Background(), task)
        }()
    }

    wg.Wait()
    close(errs)
    for err := range errs {
        if err != nil {
            t.Fatal(err)
        }
    }

    if n := r.HGet(context.Background(), c.Key("counts"), "idempotent").Val(); n != "1" {
        t.Fatal("原子幂等", n)
    }
    if err := service.ProcessTask(context.Background(), asynq.NewTask(subject.Type, []byte("{}"))); !errors.Is(err, asynq.SkipRetry) {
        t.Fatal(err)
    }
}
