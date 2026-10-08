// Package schedule 提供代码定义、Redis Leader 租约和共享启停的任务调度。
package schedule

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/lock"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "context"
    "errors"
    "fmt"
    "github.com/redis/go-redis/v9"
    "github.com/robfig/cron/v3"
    "log/slog"
    "regexp"
    "time"
    _ "time/tzdata"
)

var validName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,96}$`)

// LeaseTTL 定义调度 Leader 的租约有效时间。
const LeaseTTL = 3 * time.Second

var parser = cron.NewParser(cron.SecondOptional | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor)

// Definition 固定在代码，后台共享配置仅控制 enabled。
type Definition struct {
    Name                            string
    Expression                      string
    Timezone                        string
    EnabledByDefault                bool
    JobName, QueueName, Description string
}

// Parse 校验调度名和时区，解析带显式时区的 cron 或周期表达式。
func (d Definition) Parse() (cron.Schedule, error) {
    if !validName.MatchString(d.Name) {
        return nil, errors.New("调度名无效")
    }
    if _, err := time.LoadLocation(d.Timezone); err != nil {
        return nil, err
    }
    return parser.Parse("CRON_TZ=" + d.Timezone + " " + d.Expression)
}

// Scheduler 每轮读取 Redis TIME，缩小不同宿主机时钟偏差。
type Scheduler struct {
    Config     queue.Config
    Redis      *redis.Client
    Enqueue    func(context.Context, string) (bool, error)
    Lease      lock.Lease
    Definition Definition
    Parsed     cron.Schedule
}

func (s *Scheduler) enabledKey() string { return s.Config.Key("enabled:" + s.Definition.Name) }

// SetEnabled 持久化共享启停状态，已存在状态覆盖默认配置。
func (s *Scheduler) SetEnabled(ctx context.Context, v bool) error {
    value := "0"
    if v {
        value = "1"
    }
    return s.Redis.Set(ctx, s.enabledKey(), value, 0).Err()
}

// Enabled 读取共享启停键，只有值为 1 时返回启用。
func (s *Scheduler) Enabled(ctx context.Context) (bool, error) {
    v, e := s.Redis.Get(ctx, s.enabledKey()).Result()
    return v == "1", e
}

// Initialize 校验调度依赖并以 SETNX 写入默认启停状态，保留后台已有设置。
func (s *Scheduler) Initialize(ctx context.Context) error {
    if s.Enqueue == nil || s.Parsed == nil || s.Lease.TTL < time.Second {
        return errors.New("调度依赖或租约配置无效")
    }

    value := "0"
    if s.Definition.EnabledByDefault {
        value = "1"
    }
    return s.Redis.SetNX(ctx, s.enabledKey(), value, 0).Err()
}

// Dispatch 把幂等键传给应用入队回调，返回本次是否新增任务。
func (s *Scheduler) Dispatch(ctx context.Context, key string) (bool, error) {
    if s.Enqueue == nil {
        return false, errors.New("调度派发函数缺失")
    }
    return s.Enqueue(ctx, key)
}

// Manual 使用调度名和请求 ID 构造独立的手动触发幂等键。
func (s *Scheduler) Manual(ctx context.Context, requestID string) (bool, error) {
    if !validName.MatchString(requestID) {
        return false, errors.New("手动触发需要有效请求 ID")
    }
    return s.Dispatch(ctx, "manual:"+s.Definition.Name+":"+requestID)
}

// Due 将 @every 周期锚定到 UTC epoch，使 Leader 切换保持相同相位。
func Due(schedule cron.Schedule, slot time.Time) bool {
    if interval, ok := schedule.(cron.ConstantDelaySchedule); ok {
        return slot.Unix()%int64(interval.Delay/time.Second) == 0
    }
    return schedule.Next(slot.Add(-time.Second)).Equal(slot)
}

// Tick 刷新租约及心跳，由 Leader 按 Redis 时间槽和共享开关派发任务。
func (s *Scheduler) Tick(ctx context.Context) error {
    leader, e := s.Lease.Acquire(ctx)
    if e != nil {
        return e
    }

    now, e := s.Redis.Time(ctx).Result()
    if e != nil {
        return e
    }
    if e = s.heartbeat(ctx, now); e != nil {
        return e
    }
    if !leader {
        return nil
    }

    enabled, e := s.Enabled(ctx)
    if e != nil || !enabled {
        return e
    }

    slot := now.Truncate(time.Second)
    if !Due(s.Parsed, slot) {
        return nil
    }
    // 入队前确认有效租约。唯一任务 ID 和业务幂等共同保护租约过期竞态。
    owned, e := s.Lease.Owned(ctx)
    if e != nil || !owned {
        return e
    }

    key := fmt.Sprintf("schedule:%s:%d", s.Definition.Name, slot.Unix())
    stateKey := s.Config.Key("schedule-state:" + s.Definition.Name)
    if e = s.Redis.HSet(ctx, stateKey, "lastAttemptAt", now.UnixMilli()).Err(); e != nil {
        return e
    }

    fresh, e := s.Dispatch(ctx, key)
    if e != nil {
        // 对外仅展示派发结果；内部错误继续由 Worker 日志记录。
        if stateErr := s.Redis.HSet(ctx, stateKey, "lastResult", "dispatch_failed").Err(); stateErr != nil {
            return errors.Join(e, stateErr)
        }
        return e
    }
    if fresh {
        return s.Redis.HSet(ctx, s.Config.Key("schedule-state:"+s.Definition.Name), "lastRunKey", key, "lastDispatchedAt", now.UnixMilli(), "lastResult", "dispatched", "leader", s.Config.Instance).Err()
    }
    return nil
}

// Run 初始化调度后每 250 毫秒检查一次，取消时限时释放租约并移除心跳。
func (s *Scheduler) Run(ctx context.Context) error {
    if err := s.Initialize(ctx); err != nil {
        return err
    }

    ticker := time.NewTicker(250 * time.Millisecond)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            releaseCtx, cancel := context.WithTimeout(context.Background(), time.Second)
            defer cancel()
            return errors.Join(s.Lease.Release(releaseCtx), s.removeHeartbeat(releaseCtx))
        case <-ticker.C:
            tickCtx, cancel := context.WithTimeout(ctx, time.Second)
            err := s.Tick(tickCtx)
            cancel()
            if err != nil && ctx.Err() == nil {
                slog.Warn("调度检查失败", "instance", s.Config.Instance, "error", err)
            }
        }
    }
}
