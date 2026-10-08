package queue

// 本文件覆盖Worker 指标汇总、检查器能力降级及读取期间新增采样的处理。

import (
    "context"
    "encoding/json"
    "errors"
    "strings"
    "sync"
    "testing"
    "time"

    infra "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "github.com/hibiken/asynq"
    "github.com/redis/go-redis/v9"
)

type workerInspector struct {
    *memoryInspector
    servers []*asynq.ServerInfo
    err     error
}

func (i *workerInspector) Servers() ([]*asynq.ServerInfo, error) { return i.servers, i.err }

func TestWorkerDashboard(t *testing.T) {
    i := &workerInspector{memoryInspector: &memoryInspector{}}
    s, c, _ := redisService(t, i)
    ctx := context.Background()
    server := func(id string, pid, concurrency int, queues ...string) *asynq.ServerInfo {
        q := map[string]int{}
        for _, name := range queues {
            q[c.Queue(name)] = 1
        }

        return &asynq.ServerInfo{
            ID:          id,
            Host:        "local",
            PID:         pid,
            Concurrency: concurrency,
            Status:      "active",
            Started:     time.Now().Add(-time.Minute),
            Queues:      q,
        }
    }
    first := server("first", 1, 2, "critical", "default", "low")
    second := server("second", 2, 2, "default")
    stopped := server("stopped", 3, 2, "low")
    stopped.Status = "stopped"
    other := server("other", 4, 2, "default")
    other.Queues = map[string]int{c.Namespace + "-other-default": 1}
    mixed := server("mixed", 5, 2, "default")
    mixed.Queues["other-default"] = 1
    i.servers = []*asynq.ServerInfo{nil, first, first, second, stopped, other, mixed}
    now := float64(s.redis.Time(ctx).Val().UnixMilli())
    sample := func(id string, bytes *float64, at float64) {
        raw, _ := json.Marshal(infra.ProcessMetrics{MemoryBytes: bytes, SampledAt: at})
        if err := s.redis.Set(ctx, infra.ProcessMetricsKey(c, id), raw, infra.ProcessMetricsTTL).Err(); err != nil {
            t.Fatal(err)
        }
    }
    sample(first.ID, number(1024), now)
    sample(second.ID, number(2048), now)
    got, err := s.Dashboard(ctx)
    if err != nil {
        t.Fatal(err)
    }

    process := got.WorkerProcesses[0]
    if !got.Capabilities.SupportsWorkerPresence || !got.HasOnlineWorkers || got.Overview.OnlineWorkers != 2 || len(got.WorkerProcesses) != 1 || process.OnlineInstances != 2 || process.Instances != nil || process.Concurrency == nil || *process.Concurrency != 2 || process.MemoryBytes == nil || *process.MemoryBytes != 3072 {
        t.Fatalf("进程聚合：%+v，%+v", got, process)
    }
    if got.Queues[0].WorkerCount != 1 || got.Queues[1].WorkerCount != 2 || got.Queues[2].WorkerCount != 1 {
        t.Fatal("队列消费者数量", got.Queues)
    }

    for _, q := range got.Queues {
        if q.Concurrency != nil || q.WorkerProcessName == nil || *q.WorkerProcessName != c.Namespace+"-worker" {
            t.Fatal("共享池归属", q)
        }
    }

    t.Run("同一进程的多个服务器内存与在线数量去重", func(t *testing.T) {
        duplicate := server("third", 1, 2, "low")
        i.servers = append(i.servers, duplicate)
        got, err := s.Dashboard(ctx)
        if err != nil || got.Overview.OnlineWorkers != 2 || got.WorkerProcesses[0].MemoryBytes == nil || *got.WorkerProcesses[0].MemoryBytes != 3072 {
            t.Fatal(got, err)
        }

        i.servers = i.servers[:len(i.servers)-1]
    })
    t.Run("同一进程的未来样本保留合法采样", func(t *testing.T) {
        duplicate := server("future-server", 1, 2, "low")
        i.servers = append(i.servers, duplicate)
        sample(duplicate.ID, number(8192), now+60000)
        got, err := s.Dashboard(ctx)
        if err != nil || got.Overview.OnlineWorkers != 2 || got.WorkerProcesses[0].MemoryBytes == nil || *got.WorkerProcesses[0].MemoryBytes != 3072 {
            t.Fatal(got, err)
        }

        i.servers = i.servers[:len(i.servers)-1]
    })
    for _, kind := range []string{
        "missing",
        "expired",
        "unsupported",
        "corrupt",
        "negative",
        "future",
    } {
        t.Run(kind, func(t *testing.T) {
            sample(second.ID, number(2048), now)
            key := infra.ProcessMetricsKey(c, second.ID)
            switch kind {
            case "missing":
                s.redis.Del(ctx, key)
            case "expired":
                sample(second.ID, number(2048), now-float64(infra.ProcessMetricsTTL.Milliseconds()))
            case "unsupported":
                sample(second.ID, nil, now)
            case "corrupt":
                s.redis.Set(ctx, key, "broken", infra.ProcessMetricsTTL)
            case "negative":
                sample(second.ID, number(-1), now)
            case "future":
                sample(second.ID, number(2048), now+60000)
            }

            got, err := s.Dashboard(ctx)
            if err != nil || got.WorkerProcesses[0].MemoryBytes != nil || got.Overview.OnlineWorkers != 2 {
                t.Fatal(got, err)
            }
        })
    }

    t.Run("部分队列在线", func(t *testing.T) {
        i.servers = []*asynq.ServerInfo{second}
        got, err := s.Dashboard(ctx)
        if err != nil || got.HasOnlineWorkers || got.Overview.OnlineWorkers != 1 || got.Queues[0].IsListening || !got.Queues[1].IsListening {
            t.Fatal(got, err)
        }
    })
    t.Run("不同并发配置保留空值", func(t *testing.T) {
        second.Concurrency = 4
        i.servers = []*asynq.ServerInfo{first, second}
        got, err := s.Dashboard(ctx)
        if err != nil || got.WorkerProcesses[0].Concurrency != nil {
            t.Fatal(got, err)
        }
    })
    t.Run("离线保留配置行", func(t *testing.T) {
        i.servers = nil
        got, err := s.Dashboard(ctx)
        if err != nil || got.HasOnlineWorkers || got.Overview.OnlineWorkers != 0 || got.WorkerProcesses[0].IsOnline || got.WorkerProcesses[0].MemoryBytes != nil || *got.WorkerProcesses[0].Concurrency != c.Concurrency {
            t.Fatal(got, err)
        }
    })
    t.Run("内部错误安全投影", func(t *testing.T) {
        i.err = errors.New("password=internal-secret")
        _, err := s.Dashboard(ctx)
        if err == nil || strings.Contains(err.Error(), "internal-secret") {
            t.Fatal(err)
        }
    })
}

func TestWorkerDashboardUnsupportedInspector(t *testing.T) {
    s, _, _ := redisService(t, &memoryInspector{})
    got, err := s.Dashboard(context.Background())
    if err != nil || got.Capabilities.SupportsWorkerPresence || len(got.WorkerProcesses) != 0 {
        t.Fatal(got, err)
    }
}

// 在指标 GET 前发布新采样，稳定覆盖时间快照与采样发布之间的交错。
type metricsReadHook struct {
    key    string
    before func(context.Context) error
    once   sync.Once
    err    error
}

func (h *metricsReadHook) DialHook(next redis.DialHook) redis.DialHook { return next }

func (h *metricsReadHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
    return next
}

func (h *metricsReadHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
    return func(ctx context.Context, cmd redis.Cmder) error {
        if cmd.Name() == "get" && cmd.Args()[1] == h.key {
            h.once.Do(func() { h.err = h.before(ctx) })
            if h.err != nil {
                return h.err
            }
        }
        return next(ctx, cmd)
    }
}

func TestWorkerDashboardSamplePublishedDuringRead(t *testing.T) {
    inspector := &workerInspector{memoryInspector: &memoryInspector{}}
    s, config, _ := redisService(t, inspector)
    inspector.servers = []*asynq.ServerInfo{{
        ID:          "fresh-sample",
        Host:        "host",
        PID:         1,
        Status:      "active",
        Concurrency: 1,
        Queues:      map[string]int{config.Queue("default"): 1},
    }}
    writer := redis.NewClient(s.redis.Options())
    defer writer.Close()
    key := infra.ProcessMetricsKey(config, "fresh-sample")
    s.redis.AddHook(&metricsReadHook{
        key: key,
        before: func(ctx context.Context) error {
            time.Sleep(3 * time.Millisecond)
            now, err := writer.Time(ctx).Result()
            if err != nil {
                return err
            }

            raw, err := json.Marshal(infra.ProcessMetrics{MemoryBytes: number(4096), SampledAt: float64(now.UnixMilli())})
            if err != nil {
                return err
            }
            return writer.Set(ctx, key, raw, infra.ProcessMetricsTTL).Err()
        },
    })
    got, err := s.Dashboard(context.Background())
    if err != nil {
        t.Fatal(err)
    }

    process := got.WorkerProcesses[0]
    if got.Overview.OnlineWorkers != 1 || process.MemoryBytes == nil || *process.MemoryBytes != 4096 {
        t.Fatalf("新发布的合法采样：%+v", process)
    }
}
