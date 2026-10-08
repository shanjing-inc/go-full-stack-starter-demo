package queue

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "math"

    infra "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "github.com/redis/go-redis/v9"
)

// workerProcesses 将原生实例聚合为 Go 的共享进程组，消费数量按队列分别统计。
func (s *Service) workerProcesses(ctx context.Context, result *DashboardPayload) error {
    inspector, supported := s.inspector.(infra.ServerInspector)
    if !supported {
        return nil
    }

    servers, err := inspector.Servers()
    if err != nil {
        return err
    }

    result.Capabilities.SupportsWorkerPresence = true
    name, group := s.config.Namespace+"-worker", "shared"
    concurrency := s.config.Concurrency
    process := &WorkerProcess{
        Name:         name,
        ProcessGroup: group,
        Concurrency:  &concurrency,
        Queues:       []string{"critical", "default", "low"},
    }
    for _, queue := range result.Queues {
        queue.WorkerProcessName = &name
        queue.WorkerProcessGroup = &group
    }

    seenServers, seenProcesses := map[string]bool{}, map[string]bool{}
    candidates := map[string][]infra.ProcessMetrics{}
    for _, server := range servers {
        if !infra.OwnsServer(s.config, server) || server.Status != "active" || seenServers[server.ID] {
            continue
        }

        seenServers[server.ID] = true
        if len(seenServers) == 1 {
            concurrency = server.Concurrency
        } else if concurrency != server.Concurrency {
            process.Concurrency = nil
        }

        for _, queue := range result.Queues {
            if server.Queues[queue.PhysicalQueueName] > 0 {
                queue.WorkerCount++
                queue.IsListening = true
            }
        }
        // 同一宿主与 PID 的多个 Server 共享一份 RSS，进程总数与内存均去重。
        identity := fmt.Sprintf("%s:%d", server.Host, server.PID)
        if !seenProcesses[identity] {
            seenProcesses[identity] = true
            process.OnlineInstances++
        }

        raw, e := s.redis.Get(ctx, infra.ProcessMetricsKey(s.config, server.ID)).Bytes()
        if errors.Is(e, redis.Nil) {
            continue
        }
        if e != nil {
            return e
        }

        var metrics infra.ProcessMetrics
        if json.Unmarshal(raw, &metrics) != nil || metrics.MemoryBytes == nil || math.IsNaN(*metrics.MemoryBytes) || math.IsInf(*metrics.MemoryBytes, 0) || *metrics.MemoryBytes < 0 {
            continue
        }

        candidates[identity] = append(candidates[identity], metrics)
    }
    // 全部采样读取完成后取得校验时间，覆盖读取期间发布的合法新样本。
    now, err := s.redis.Time(ctx).Result()
    if err != nil {
        return err
    }

    samples := map[string]infra.ProcessMetrics{}
    for identity, metrics := range candidates {
        for _, sample := range metrics {
            if math.IsNaN(sample.SampledAt) || math.IsInf(sample.SampledAt, 0) || sample.SampledAt <= float64(now.Add(-infra.ProcessMetricsTTL).UnixMilli()) || sample.SampledAt > float64(now.UnixMilli()) {
                continue
            }

            previous, exists := samples[identity]
            if !exists || previous.SampledAt < sample.SampledAt {
                samples[identity] = sample
            }
        }
    }

    process.IsOnline = process.OnlineInstances > 0
    if process.IsOnline && len(samples) == len(seenProcesses) {
        totalMemory := 0.0
        for _, metrics := range samples {
            totalMemory += *metrics.MemoryBytes
        }

        process.MemoryBytes = number(totalMemory)
    }

    result.WorkerProcesses = append(result.WorkerProcesses, process)
    result.Overview.OnlineWorkers = process.OnlineInstances
    result.HasOnlineWorkers = true
    for _, queue := range result.Queues {
        result.HasOnlineWorkers = result.HasOnlineWorkers && queue.IsListening
        queue.Description = "Asynq 共享并发池"
    }

    return nil
}
