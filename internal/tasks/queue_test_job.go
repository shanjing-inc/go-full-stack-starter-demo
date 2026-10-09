// Package tasks 中的测试任务供公开 SSR 演示页与 Worker 共用。
package tasks

import (
    "context"
    "encoding/json"
    "errors"
    "time"

    infra "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "github.com/google/uuid"
    "github.com/hibiken/asynq"
    "github.com/redis/go-redis/v9"
)

// QueueTestType 定义公开队列演示使用的独立任务类型。
const QueueTestType = "demo:queue-test"

// QueueTestPayload 保存逻辑队列、失败模式、请求时间及固定来源标识。
type QueueTestPayload struct {
    Queue       string `json:"queue"`
    Mode        string `json:"mode"`
    RequestedAt string `json:"requestedAt"`
    Source      string `json:"source"`
}

// ValidTestQueue 接受 critical、default 和 low 三个逻辑队列。
func ValidTestQueue(queue string) bool {
    return queue == "default" || queue == "critical" || queue == "low"
}

// ValidTestMode 接受成功、首次失败和持续失败三种演示模式。
func ValidTestMode(mode string) bool {
    return mode == "success" || mode == "fail-once" || mode == "always-fail"
}

// Validate 校验队列、执行模式、固定来源及带时区的请求时间。
func (p QueueTestPayload) Validate() error {
    _, err := time.Parse(time.RFC3339Nano, p.RequestedAt)
    if !ValidTestQueue(p.Queue) || !ValidTestMode(p.Mode) || p.Source != "queue-test-page" || err != nil {
        return errors.New("测试任务参数无效")
    }
    return nil
}

// QueueTestService 使用独立任务类型；失败任务由后台现有重试能力恢复。
type QueueTestService struct {
    Client *asynq.Client
    Redis  *redis.Client
    Config infra.Config
}

// Enqueue 校验演示载荷并分配随机任务 ID，初次失败进入历史以演示人工重试。
func (s QueueTestService) Enqueue(ctx context.Context, queue, mode string) (*asynq.TaskInfo, error) {
    p := QueueTestPayload{
        Queue:       queue,
        Mode:        mode,
        RequestedAt: time.Now().UTC().Format(time.RFC3339Nano),
        Source:      "queue-test-page",
    }
    if err := p.Validate(); err != nil {
        return nil, err
    }
    // 演示任务首次失败后进入失败列表，便于观察人工 Retry 的完整链路。
    return infra.Enqueue(ctx, s.Client, s.Config, queue, QueueTestType, p, uuid.NewString(), 0, 10*time.Second)
}

// ProcessTask 执行演示失败模式；首次失败标记由队列与原任务 ID 在 Redis 中隔离。
func (s QueueTestService) ProcessTask(ctx context.Context, task *asynq.Task) error {
    var p QueueTestPayload
    if json.Unmarshal(task.Payload(), &p) != nil || p.Validate() != nil {
        return errors.Join(errors.New("测试任务载荷无效"), asynq.SkipRetry)
    }

    switch p.Mode {
    case "always-fail":
        return errors.Join(errors.New("演示任务被配置为持续失败，用于观察失败记录"), asynq.SkipRetry)
    case "fail-once":
        id, ok := asynq.GetTaskID(ctx)
        if !ok || id == "" || s.Redis == nil {
            return errors.New("测试任务运行上下文无效")
        }
        first, err := s.Redis.SetNX(ctx, s.Config.Key("queue-test:fail-once:"+p.Queue+":"+id), "1", time.Hour).Result()
        if err != nil {
            return errors.New("测试任务状态保存失败")
        }
        if first {
            return errors.Join(errors.New("演示任务首次执行失败；请在队列管理中重试"), asynq.SkipRetry)
        }
    }

    return nil
}
