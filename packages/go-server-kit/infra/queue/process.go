package queue

import (
    "context"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "errors"
    "log/slog"
    "os"
    "strconv"
    "strings"
    "time"

    "github.com/hibiken/asynq"
    "github.com/redis/go-redis/v9"
)

// ProcessMetricsTTL 限定进程展示采样的有效窗口。
const ProcessMetricsTTL = 10 * time.Second

// ProcessMetricsInterval 定义进程内存采样与刷新间隔。
const ProcessMetricsInterval = 3 * time.Second

// ServerInspector 使用 Asynq 原生心跳作为消费进程的在线依据。
type ServerInspector interface {
    Servers() ([]*asynq.ServerInfo, error)
}

// ProcessMetrics 仅存储展示指标，原生 Server ID 保持内部使用。
type ProcessMetrics struct {
    MemoryBytes *float64 `json:"memoryBytes"`
    SampledAt   float64  `json:"sampledAt"`
}

// ProcessMetricsKey 用原生 Server ID 的摘要定位当前部署的采样键。
func ProcessMetricsKey(config Config, serverID string) string {
    digest := sha256.Sum256([]byte(serverID))
    return config.Key("process-metrics:" + hex.EncodeToString(digest[:]))
}

// OwnsServer 要求进程监听的全部队列属于当前部署，隔离共享 Redis 中的其他项目。
func OwnsServer(config Config, server *asynq.ServerInfo) bool {
    if server == nil || server.ID == "" || len(server.Queues) == 0 {
        return false
    }

    for name, weight := range server.Queues {
        if weight <= 0 {
            return false
        }
        if name != config.Queue("critical") && name != config.Queue("default") && name != config.Queue("low") {
            return false
        }
    }

    return true
}

// RSSBytes 读取 Linux 常驻内存；其他运行环境保留空采样。
func RSSBytes() *float64 {
    raw, err := os.ReadFile("/proc/self/status")
    if err != nil {
        return nil
    }
    return parseRSS(string(raw))
}

// parseRSS 解析 Linux 状态中的 VmRSS 并换算为字节，缺失或无效时返回 nil。
func parseRSS(raw string) *float64 {
    for _, line := range strings.Split(raw, "\n") {
        fields := strings.Fields(line)
        if len(fields) != 3 || fields[0] != "VmRSS:" || fields[2] != "kB" {
            continue
        }

        value, err := strconv.ParseUint(fields[1], 10, 53)
        if err != nil {
            return nil
        }

        bytes := float64(value) * 1024
        return &bytes
    }

    return nil
}

// ObserveProcess 绑定当前启动的 Server，定期上报内存并在取消后清理采样。
// since 由应用在启动 Server 前记录，用于隔离同 PID 的旧启动记录。
func ObserveProcess(ctx context.Context, r *redis.Client, inspector ServerInspector, config Config, since time.Time) {
    host, err := os.Hostname()
    if err != nil {
        host = "unknown-host"
    }

    keys := map[string]bool{}
    defer func() {
        cleanup, cancel := context.WithTimeout(context.Background(), 2*time.Second)
        defer cancel()
        for key := range keys {
            if err := r.Del(cleanup, key).Err(); err != nil {
                slog.Warn("Worker 内存采样清理失败")
            }
        }
    }()
    ticker := time.NewTicker(ProcessMetricsInterval)
    defer ticker.Stop()
    for {
        sample, cancel := context.WithTimeout(ctx, 2*time.Second)
        err := publishProcessMetrics(sample, r, inspector, config, since, host, os.Getpid(), keys)
        cancel()
        if err != nil && !errors.Is(err, context.Canceled) && ctx.Err() == nil {
            slog.Warn("Worker 内存采样暂时不可用")
        }

        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
        }
    }
}

// publishProcessMetrics 只刷新同宿主机、同 PID、同启动代次且属于本部署的活动 Server 采样。
func publishProcessMetrics(ctx context.Context, r *redis.Client, inspector ServerInspector, config Config, since time.Time, host string, pid int, keys map[string]bool) error {
    servers, err := inspector.Servers()
    if err != nil {
        return err
    }

    now, err := r.Time(ctx).Result()
    if err != nil {
        return err
    }

    raw, err := json.Marshal(ProcessMetrics{MemoryBytes: RSSBytes(), SampledAt: float64(now.UnixMilli())})
    if err != nil {
        return err
    }

    for _, server := range servers {
        if !OwnsServer(config, server) || server.Host != host || server.PID != pid || server.Started.Before(since) || server.Status != "active" {
            continue
        }

        key := ProcessMetricsKey(config, server.ID)
        keys[key] = true
        if err := r.Set(ctx, key, raw, ProcessMetricsTTL).Err(); err != nil {
            return err
        }
    }

    return nil
}
