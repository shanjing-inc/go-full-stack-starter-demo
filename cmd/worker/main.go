// Package main 装配应用消费与调度进程及其关闭流程。
package main

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/lock"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/logging"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/schedule"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/tasks"
    "context"
    "crypto/rand"
    "encoding/hex"
    "errors"
    "log/slog"
    "os"
    "os/signal"
    "syscall"
    "time"
    _ "time/tzdata"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database/revision"
    worker "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/buildinfo"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/config"

    queuerecords "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/queue"
    "github.com/hibiken/asynq"
)

// main 装配结构化日志并运行 Worker，失败时通过非零退出码报告。
func main() {
    slog.SetDefault(logging.New(os.Stdout, slog.LevelInfo))
    if err := run(); err != nil {
        slog.Error("Worker 退出", "error", err)
        os.Exit(1)
    }
}

// run 核验版本与 Redis 后装配消费、调度及历史维护，信号取消时收敛各后台生命周期。
func run() error {
    c, err := config.Load("worker")
    if err != nil {
        return err
    }

    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()
    startup, cancel := context.WithTimeout(ctx, 3*time.Second)
    defer cancel()
    gate, err := schema.Open(startup, c.Driver, c.DSN, c.Version)
    if err != nil {
        return err
    }
    defer gate.Close()
    r, opt, err := worker.Open(c.Worker)
    if err != nil {
        return errors.New("Redis 配置失败")
    }
    defer r.Close()
    if r.Ping(startup).Err() != nil {
        return errors.New("Redis 启动检查失败")
    }

    inspector := asynq.NewInspector(opt)
    defer inspector.Close()
    records, err := queuerecords.New(r, inspector, c.Worker, c.QueueRecordRetention, tasks.DemoSchedule)
    if err != nil {
        return err
    }

    c.Worker.Observer = records
    client := asynq.NewClient(opt)
    defer client.Close()
    parsed, err := tasks.DemoSchedule.Parse()
    if err != nil {
        return err
    }

    token := make([]byte, 16)
    if _, err = rand.Read(token); err != nil {
        return err
    }

    scheduler := &schedule.Scheduler{
        Config: c.Worker,
        Redis:  r,
        Enqueue: func(ctx context.Context, key string) (bool, error) {
            _, err := tasks.Enqueue(ctx, client, c.Worker, tasks.Payload{Key: key})
            if errors.Is(err, asynq.ErrTaskIDConflict) {
                return false, nil
            }
            return err == nil, err
        },
        Definition: tasks.DemoSchedule,
        Parsed:     parsed,
        Lease: lock.Lease{
            Redis: r,
            Key:   c.Worker.Key("leader"),
            Token: c.Worker.Instance + ":" + hex.EncodeToString(token),
            TTL:   schedule.LeaseTTL,
        },
    }
    if scheduler.Initialize(startup) != nil {
        return errors.New("调度初始化失败")
    }

    mux := asynq.NewServeMux()
    mux.Handle(tasks.Type, tasks.Service{Redis: r, Config: c.Worker})
    mux.Handle(tasks.QueueTestType, tasks.QueueTestService{Redis: r, Config: c.Worker})
    workerStarted := time.Now()
    server, err := worker.NewServer(c.Worker, opt, mux)
    if err != nil {
        return err
    }

    metricsCtx, cancelMetrics := context.WithCancel(ctx)
    metricsDone := make(chan struct{})
    go func() {
        defer close(metricsDone)
        worker.ObserveProcess(metricsCtx, r, inspector, c.Worker, workerStarted)
    }()
    defer func() {
        cancelMetrics()
        <-metricsDone
    }()
    schedulerCtx, cancelScheduler := context.WithCancel(ctx)
    defer cancelScheduler()
    maintenanceDone := make(chan struct{})
    go func() {
        defer close(maintenanceDone)
        records.Maintain(schedulerCtx)
    }()
    defer func() {
        cancelScheduler()
        <-maintenanceDone
    }()
    done := make(chan error, 1)
    go func() { done <- scheduler.Run(schedulerCtx) }()
    slog.Info("Worker 就绪", "revision", buildinfo.Revision, "pid", os.Getpid())
    select {
    case err = <-done:
        cancelScheduler()
        server.Stop()
        server.Shutdown()
        return errors.New("调度提前退出")
    case <-ctx.Done():
    }

    server.Stop()
    cancelScheduler()
    err = <-done
    server.Shutdown()
    if err != nil {
        return errors.New("调度退出失败")
    }
    slog.Info("Worker 已退出")
    return nil
}
