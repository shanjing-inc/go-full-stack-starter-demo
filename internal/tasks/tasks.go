// Package tasks 定义应用自己的队列任务和幂等副作用。
package tasks

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/schedule"
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "github.com/hibiken/asynq"
    "github.com/redis/go-redis/v9"
    "time"
)

// Type 定义应用幂等副作用的任务类型。
const Type = "demo:effect"

// Payload 携带业务幂等键与可选模拟工作毫秒数。
type Payload struct {
    Key    string `json:"key"`
    WorkMS int    `json:"workMs,omitempty"`
}

// Validate 限制幂等键为 1–512 字节，模拟工作时长为 0–5000 毫秒。
func (p Payload) Validate() error {
    if p.Key == "" || len(p.Key) > 512 || p.WorkMS < 0 || p.WorkMS > 5000 {
        return errors.New("任务参数无效")
    }
    return nil
}

// Enqueue 校验载荷并按业务键摘要生成任务 ID，投递到默认队列。
func Enqueue(ctx context.Context, client *asynq.Client, c queue.Config, p Payload) (*asynq.TaskInfo, error) {
    if err := p.Validate(); err != nil {
        return nil, err
    }
    return queue.Enqueue(ctx, client, c, "default", Type, p, queue.TaskID(p.Key), 3, 10*time.Second)
}

// DemoSchedule 定义默认停用的每分钟演示调度。
var DemoSchedule = schedule.Definition{
    Name:             "demo-tick",
    Expression:       "@every 1m",
    Timezone:         "Asia/Shanghai",
    EnabledByDefault: false,
    JobName:          Type,
    QueueName:        "default",
    Description:      "每分钟派发示例幂等任务，默认停用",
}

// Service 提供共享 Redis 上的原子幂等副作用处理。
type Service struct {
    Redis  *redis.Client
    Config queue.Config
}

// effect 原子登记首次副作用并增加计数，重复业务键保持幂等。
var effect = redis.NewScript(`if redis.call('HSETNX',KEYS[1],ARGV[1],ARGV[2])==0 then return 0 end;redis.call('HINCRBY',KEYS[2],ARGV[1],1);return 1`)

// ProcessTask 校验载荷并执行可取消模拟等待，以 Lua 原子登记副作用和执行计数。
func (s Service) ProcessTask(ctx context.Context, t *asynq.Task) error {
    var p Payload
    if json.Unmarshal(t.Payload(), &p) != nil || p.Validate() != nil {
        return fmt.Errorf("任务载荷无效: %w", asynq.SkipRetry)
    }
    if p.WorkMS > 0 {
        timer := time.NewTimer(time.Duration(p.WorkMS) * time.Millisecond)
        defer timer.Stop()
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
        }
    }
    return effect.Run(ctx, s.Redis, []string{s.Config.Key("effects"), s.Config.Key("counts")}, p.Key, s.Config.Instance).Err()
}
