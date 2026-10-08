package queue

// 本文件覆盖RSS 单位解析、进程指标隔离与发布退出清理，并验证原生 Asynq 进程标识。

import (
    "context"
    "encoding/json"
    "os"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/internal/testredis"
    "github.com/hibiken/asynq"
)

func TestRSSParsing(t *testing.T) {
    for _, tc := range []struct {
        raw      string
        expected *float64
    }{
        {raw: "Name: worker\nVmRSS:\t1234 kB\n", expected: rssNumber(1234 * 1024)},
        {raw: "VmRSS: 0 kB", expected: rssNumber(0)},
        {raw: "VmRSS: -1 kB"}, {raw: "VmRSS: invalid kB"}, {raw: "VmRSS: 4 MB"}, {raw: "VmSize: 123 kB"},
    } {
        got := parseRSS(tc.raw)
        if (got == nil) != (tc.expected == nil) || (got != nil && *got != *tc.expected) {
            t.Fatalf("RSS 解析错误：%q，%v", tc.raw, got)
        }
    }
}

func rssNumber(n float64) *float64 { return &n }

type processInspector struct{ servers []*asynq.ServerInfo }

func (i processInspector) Servers() ([]*asynq.ServerInfo, error) { return i.servers, nil }

func TestProcessMetricsIsolationAndLifecycle(t *testing.T) {
    r, namespace := testredis.Open(t)
    c := Config{
        RedisURL:        os.Getenv("REDIS_TEST_URL"),
        Namespace:       namespace,
        Instance:        "worker",
        Concurrency:     1,
        ShutdownTimeout: time.Second,
    }
    host, _ := os.Hostname()
    since := time.Now().Add(-time.Second)
    local := &asynq.ServerInfo{
        ID:      "local",
        Host:    host,
        PID:     os.Getpid(),
        Started: time.Now(),
        Status:  "active",
        Queues:  map[string]int{c.Queue("default"): 3},
    }
    servers := []*asynq.ServerInfo{local}
    for n, change := range []func(*asynq.ServerInfo){
        func(s *asynq.ServerInfo) { s.Host += "-remote" },
        func(s *asynq.ServerInfo) { s.PID++ },
        func(s *asynq.ServerInfo) { s.Started = since.Add(-time.Second) },
        func(s *asynq.ServerInfo) { s.Status = "stopped" },
        func(s *asynq.ServerInfo) { s.Queues = map[string]int{"other-default": 1} },
        func(s *asynq.ServerInfo) { s.Queues = map[string]int{c.Queue("default"): 1, "other-default": 1} },
    } {
        copy := *local
        copy.ID = string(rune('a' + n))
        change(&copy)
        servers = append(servers, &copy)
    }

    inspector := processInspector{servers}
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan struct{})
    go func() {
        defer close(done)
        ObserveProcess(ctx, r, inspector, c, since)
    }()
    defer func() {
        cancel()
        <-done
    }()
    key := ProcessMetricsKey(c, local.ID)
    testredis.Wait(t, func() bool { return r.Exists(context.Background(), key).Val() == 1 })
    var sample ProcessMetrics
    if err := json.Unmarshal([]byte(r.Get(ctx, key).Val()), &sample); err != nil || sample.SampledAt <= 0 {
        t.Fatal("采样内容", sample, err)
    }

    ttl := r.PTTL(ctx, key).Val()
    if ttl <= 0 || ttl > ProcessMetricsTTL {
        t.Fatal("采样有效期", ttl)
    }

    for _, server := range servers[1:] {
        if r.Exists(ctx, ProcessMetricsKey(c, server.ID)).Val() != 0 {
            t.Fatal("跨实例采样", server.ID)
        }
    }

    cancel()
    select {
    case <-done:
    case <-time.After(4 * time.Second):
        t.Fatal("采样退出超时")
    }

    if r.Exists(context.Background(), key).Val() != 0 {
        t.Fatal("退出后采样仍存在")
    }
}

func TestProcessMetricsNativeServer(t *testing.T) {
    _, namespace := testredis.Open(t)
    c := Config{
        RedisURL:        os.Getenv("REDIS_TEST_URL"),
        Namespace:       namespace,
        Instance:        "worker",
        Concurrency:     2,
        ShutdownTimeout: time.Second,
    }
    r, opt, err := Open(c)
    if err != nil {
        t.Fatal(err)
    }
    defer r.Close()
    inspector := asynq.NewInspector(opt)
    defer inspector.Close()
    since := time.Now()
    server, err := NewServer(c, opt, asynq.HandlerFunc(func(context.Context, *asynq.Task) error { return nil }))
    if err != nil {
        t.Fatal(err)
    }
    defer server.Shutdown()
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan struct{})
    go func() {
        defer close(done)
        ObserveProcess(ctx, r, inspector, c, since)
    }()
    defer func() {
        cancel()
        <-done
    }()
    var key string
    testredis.Wait(t, func() bool {
        servers, err := inspector.Servers()
        if err != nil {
            return false
        }

        for _, item := range servers {
            if OwnsServer(c, item) {
                key = ProcessMetricsKey(c, item.ID)
                return r.Exists(ctx, key).Val() == 1
            }
        }

        return false
    })
    cancel()
    <-done
    if r.Exists(context.Background(), key).Val() != 0 {
        t.Fatal("退出后采样仍存在")
    }
    server.Stop()
    server.Shutdown()
    servers, err := inspector.Servers()
    if err != nil {
        t.Fatal(err)
    }

    for _, item := range servers {
        if OwnsServer(c, item) {
            t.Fatal("退出后原生心跳仍存在")
        }
    }
}
