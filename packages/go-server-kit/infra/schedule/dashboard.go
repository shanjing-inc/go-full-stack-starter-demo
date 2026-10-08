package schedule

import (
    "context"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "errors"
    "strconv"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "github.com/redis/go-redis/v9"
    "github.com/robfig/cron/v3"
)

// HeartbeatTTL 定义调度实例心跳的有效时间。
const HeartbeatTTL = 10 * time.Second

// Heartbeat 提供安全的实例展示 ID、毫秒心跳时间与 Leader/Follower 角色。
type Heartbeat struct {
    InstanceID      string
    LastHeartbeatAt float64
    Role            string
}

// Item 汇总代码定义、共享启停与最近派发状态，可空时间表示尚无相关记录。
type Item struct {
    Name, Cron, Timezone, JobName, QueueName, Description string
    Enabled                                               bool
    NextRunAt, LastActivityAt                             *float64
    Status, StatusText                                    string
}

// Payload 汇总调度项、有效实例心跳和 Leader 展示 ID，时间统一为毫秒。
type Payload struct {
    Schedules                             []*Item
    Heartbeats                            []*Heartbeat
    ScheduleCount, SchedulerInstanceCount int
    SchedulerLeader                       *string
    UpdatedAt                             float64
}

// heartbeatState 保存内部租约 token 以识别 Leader，展示投影使用 Heartbeat。
type heartbeatState struct {
    Token           string
    InstanceID      string
    LastHeartbeatAt float64
}

// 每次进程启动生成唯一展示 ID，租约 token 保持内部使用。
func (s *Scheduler) instanceID() string {
    digest := sha256.Sum256([]byte(s.Lease.Token))
    return s.Config.Instance + "-" + hex.EncodeToString(digest[:8])
}

// heartbeat 按 Redis 时间写入带 TTL 的心跳，并清理索引中的过期成员。
func (s *Scheduler) heartbeat(ctx context.Context, now time.Time) error {
    id := s.instanceID()
    state := heartbeatState{
        Token:           s.Lease.Token,
        InstanceID:      id,
        LastHeartbeatAt: float64(now.UnixMilli()),
    }
    raw, err := json.Marshal(state)
    if err != nil {
        return err
    }

    _, err = s.Redis.TxPipelined(ctx, func(p redis.Pipeliner) error {
        p.Set(ctx, s.Config.Key("scheduler-heartbeat:"+id), raw, HeartbeatTTL)
        p.ZAdd(ctx, s.Config.Key("scheduler-heartbeats"), redis.Z{Score: state.LastHeartbeatAt, Member: id})
        p.ZRemRangeByScore(ctx, s.Config.Key("scheduler-heartbeats"), "-inf", strconv.FormatInt(now.Add(-HeartbeatTTL).UnixMilli(), 10))
        p.Expire(ctx, s.Config.Key("scheduler-heartbeats"), HeartbeatTTL)
        return nil
    })
    return err
}

// removeHeartbeat 原子移除本启动实例的心跳与索引成员。
func (s *Scheduler) removeHeartbeat(ctx context.Context) error {
    _, err := s.Redis.TxPipelined(ctx, func(p redis.Pipeliner) error {
        p.Del(ctx, s.Config.Key("scheduler-heartbeat:"+s.instanceID()))
        p.ZRem(ctx, s.Config.Key("scheduler-heartbeats"), s.instanceID())
        return nil
    })
    return err
}

// NextRun 保持 @every 与实际派发共享 UTC epoch 相位。
func NextRun(parsed cron.Schedule, now time.Time) time.Time {
    if interval, ok := parsed.(cron.ConstantDelaySchedule); ok {
        seconds := int64(interval.Delay / time.Second)
        return time.Unix((now.Unix()/seconds+1)*seconds, 0)
    }
    return parsed.Next(now)
}

// Dashboard 读取代码定义、共享启停和调度观测；时间统一来自 Redis。
func Dashboard(ctx context.Context, r *redis.Client, config queue.Config, definitions []Definition) (*Payload, error) {
    now, err := r.Time(ctx).Result()
    if err != nil {
        return nil, err
    }

    result := &Payload{
        Schedules:  []*Item{},
        Heartbeats: []*Heartbeat{},
        UpdatedAt:  float64(now.UnixMilli()),
    }
    leader, err := r.Get(ctx, config.Key("leader")).Result()
    if err != nil && !errors.Is(err, redis.Nil) {
        return nil, err
    }

    ids, err := r.ZRevRangeByScore(ctx, config.Key("scheduler-heartbeats"), &redis.ZRangeBy{Min: "(" + strconv.FormatInt(now.Add(-HeartbeatTTL).UnixMilli(), 10), Max: "+inf"}).Result()
    if err != nil {
        return nil, err
    }

    for _, id := range ids {
        raw, e := r.Get(ctx, config.Key("scheduler-heartbeat:"+id)).Bytes()
        if errors.Is(e, redis.Nil) {
            continue
        }
        if e != nil {
            return nil, e
        }

        var state heartbeatState
        if e = json.Unmarshal(raw, &state); e != nil {
            return nil, e
        }

        role := "follower"
        if state.Token == leader {
            role = "leader"
            value := state.InstanceID
            result.SchedulerLeader = &value
        }

        result.Heartbeats = append(result.Heartbeats, &Heartbeat{
            InstanceID:      state.InstanceID,
            LastHeartbeatAt: state.LastHeartbeatAt,
            Role:            role,
        })
    }

    for _, d := range definitions {
        parsed, e := d.Parse()
        if e != nil {
            return nil, e
        }

        enabledValue, e := r.Get(ctx, config.Key("enabled:"+d.Name)).Result()
        enabled := enabledValue == "1"
        if errors.Is(e, redis.Nil) {
            enabled = d.EnabledByDefault
        } else if e != nil {
            return nil, e
        }

        state, e := r.HGetAll(ctx, config.Key("schedule-state:"+d.Name)).Result()
        if e != nil {
            return nil, e
        }

        item := &Item{
            Name:        d.Name,
            Cron:        d.Expression,
            Timezone:    d.Timezone,
            JobName:     d.JobName,
            QueueName:   d.QueueName,
            Description: d.Description,
            Enabled:     enabled,
            Status:      "idle",
            StatusText:  "等待派发",
        }
        if enabled {
            if nextRun := NextRun(parsed, now); !nextRun.IsZero() {
                next := float64(nextRun.UnixMilli())
                item.NextRunAt = &next
            }
        }
        if state["lastResult"] == "dispatch_failed" {
            item.Status, item.StatusText = "dispatch_failed", "派发失败"
        }
        if state["lastResult"] == "dispatched" || state["lastResult"] == "" && state["lastDispatchedAt"] != "" {
            item.Status, item.StatusText = "dispatched", "已派发"
        }

        activity := state["lastDispatchedAt"]
        if activity == "" {
            activity = state["lastAttemptAt"]
        }
        if activity != "" {
            value, e := strconv.ParseFloat(activity, 64)
            if e != nil {
                return nil, e
            }

            item.LastActivityAt = &value
        }

        result.Schedules = append(result.Schedules, item)
    }

    result.ScheduleCount, result.SchedulerInstanceCount = len(result.Schedules), len(result.Heartbeats)
    return result, nil
}
