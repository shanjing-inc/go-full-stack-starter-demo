package queue

import (
    "context"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "errors"
    "log/slog"
    "time"

    "github.com/hibiken/asynq"
)

// TaskID 对业务幂等键计算 SHA-256，生成固定长度的队列任务标识。
func TaskID(key string) string {
    sum := sha256.Sum256([]byte(key))
    return hex.EncodeToString(sum[:])
}

// Enqueue 接收应用定义的任务类型与载荷；幂等副作用由业务 Service 维护。
func Enqueue(ctx context.Context, client *asynq.Client, c Config, logical, taskType string, payload any, id string, retries int, timeout time.Duration, extra ...asynq.Option) (*asynq.TaskInfo, error) {
    if err := c.Validate(); err != nil {
        return nil, err
    }
    if logical != "critical" && logical != "default" && logical != "low" {
        return nil, errors.New("未知队列")
    }
    if taskType == "" || retries < 0 || timeout < time.Second {
        return nil, errors.New("任务配置无效")
    }

    body, err := json.Marshal(payload)
    if err != nil {
        return nil, err
    }

    opts := []asynq.Option{
        asynq.Queue(c.Queue(logical)),
        asynq.MaxRetry(retries),
        asynq.Timeout(timeout),
        asynq.Retention(7 * 24 * time.Hour),
    }
    if id != "" {
        opts = append(opts, asynq.TaskID(id))
    }

    opts = append(opts, extra...)
    info, err := client.EnqueueContext(ctx, asynq.NewTask(taskType, body), opts...)
    if err == nil && c.Observer != nil {
        if observeErr := c.Observer.Enqueued(ctx, info); observeErr != nil {
            // 入队已成功，观测故障由 Worker 接管记录补建，避免业务方重复投递。
            slog.Error("队列入队记录保存失败", "task", info.ID)
        }
    }
    return info, err
}
