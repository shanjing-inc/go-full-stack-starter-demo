package schedule

// 本文件覆盖调度相位与 nextRun 推算、Redis 开关、默认值及旧数据兼容。

import (
    "context"
    "encoding/json"
    "errors"
    "strings"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/lock"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/internal/testredis"
    "github.com/redis/go-redis/v9"
)

func TestNextRunPhase(t *testing.T) {
    d := Definition{
        Name:       "minute",
        Expression: "@every 1m",
        Timezone:   "Asia/Shanghai",
    }
    parsed, err := d.Parse()
    if err != nil {
        t.Fatal(err)
    }

    for _, now := range []time.Time{time.Unix(59, 500000000), time.Unix(60, 0), time.Unix(119, 0)} {
        next := NextRun(parsed, now)
        if !next.After(now) || !Due(parsed, next) {
            t.Fatal(now, next)
        }
    }

    d.Expression = "0 9 * * *"
    parsed, err = d.Parse()
    if err != nil {
        t.Fatal(err)
    }

    now := time.Date(2026, 10, 6, 0, 30, 0, 0, time.UTC)
    if got := NextRun(parsed, now); !got.Equal(time.Date(2026, 10, 6, 1, 0, 0, 0, time.UTC)) {
        t.Fatal(got)
    }
}

func TestSchedulesDashboardRedis(t *testing.T) {
    r, prefix := testredis.Open(t)
    ctx := context.Background()
    t.Cleanup(func() {
        keys, _ := r.Keys(ctx, prefix+"*").Result()
        if len(keys) > 0 {
            _ = r.Del(ctx, keys...).Err()
        }
    })
    cfg := queue.Config{Namespace: prefix, Instance: "same-instance"}
    d := Definition{
        Name:        "tick",
        Expression:  "@every 1s",
        Timezone:    "Asia/Shanghai",
        JobName:     "demo:effect",
        QueueName:   "default",
        Description: "调度监控回归",
    }
    parsed, _ := d.Parse()
    fail := false
    create := func(token string) *Scheduler {
        return &Scheduler{
            Config:     cfg,
            Redis:      r,
            Definition: d,
            Parsed:     parsed,
            Lease:      lock.Lease{Redis: r, Key: cfg.Key("leader"), Token: token, TTL: LeaseTTL},
            Enqueue: func(context.Context, string) (bool, error) {
                if fail {
                    return false, errors.New("secret=internal-private-error")
                }
                return true, nil
            },
        }
    }
    a, b := create("private-token-a"), create("private-token-b")
    query := func() *Payload {
        t.Helper()
        p, err := Dashboard(ctx, r, cfg, []Definition{d})
        if err != nil {
            t.Fatal(err)
        }

        body, _ := json.Marshal(p)
        if strings.Contains(string(body), "private-token") || strings.Contains(string(body), "internal-private-error") {
            t.Fatal("内部信息泄漏", string(body))
        }
        return p
    }
    p := query()
    if p.ScheduleCount != 1 || p.SchedulerInstanceCount != 0 || p.SchedulerLeader != nil || p.Schedules[0].Enabled || p.Schedules[0].NextRunAt != nil {
        t.Fatal(p)
    }
    if err := a.Initialize(ctx); err != nil {
        t.Fatal(err)
    }
    if err := a.Tick(ctx); err != nil {
        t.Fatal(err)
    }
    if err := b.Tick(ctx); err != nil {
        t.Fatal(err)
    }

    p = query()
    if p.SchedulerInstanceCount != 2 || p.SchedulerLeader == nil || *p.SchedulerLeader != a.instanceID() {
        t.Fatal(p)
    }
    if ttl := r.TTL(ctx, cfg.Key("scheduler-heartbeats")).Val(); ttl <= 0 || ttl > HeartbeatTTL {
        t.Fatal("心跳索引需要自动过期", ttl)
    }

    roles := map[string]string{}
    for _, h := range p.Heartbeats {
        roles[h.InstanceID] = h.Role
    }

    if roles[a.instanceID()] != "leader" || roles[b.instanceID()] != "follower" || a.instanceID() == b.instanceID() {
        t.Fatal(roles)
    }
    if err := b.SetEnabled(ctx, true); err != nil {
        t.Fatal(err)
    }
    if err := a.Tick(ctx); err != nil {
        t.Fatal(err)
    }

    p = query()
    if !p.Schedules[0].Enabled || p.Schedules[0].NextRunAt == nil || p.Schedules[0].Status != "dispatched" || p.Schedules[0].LastActivityAt == nil {
        t.Fatal(p.Schedules[0])
    }

    fail = true
    if err := a.Tick(ctx); err == nil {
        t.Fatal("派发错误需要保留")
    }

    p = query()
    if p.Schedules[0].Status != "dispatch_failed" || p.Schedules[0].LastActivityAt == nil {
        t.Fatal(p.Schedules[0])
    }
    // 在线范围同时检查索引时间和对应心跳键。
    stale := heartbeatState{
        Token:           "private-token-stale",
        InstanceID:      "stale-instance",
        LastHeartbeatAt: float64(time.Now().Add(-2 * HeartbeatTTL).UnixMilli()),
    }
    raw, _ := json.Marshal(stale)
    if err := r.Set(ctx, cfg.Key("scheduler-heartbeat:"+stale.InstanceID), raw, HeartbeatTTL).Err(); err != nil {
        t.Fatal(err)
    }
    if err := r.ZAdd(ctx, cfg.Key("scheduler-heartbeats"), redis.Z{Score: stale.LastHeartbeatAt, Member: stale.InstanceID}).Err(); err != nil {
        t.Fatal(err)
    }
    if query().SchedulerInstanceCount != 2 {
        t.Fatal("过期索引需要排除")
    }
    // 过期键继续从列表中排除；残留索引保持可容错读取。
    if err := r.Del(ctx, cfg.Key("scheduler-heartbeat:"+b.instanceID())).Err(); err != nil {
        t.Fatal(err)
    }

    p = query()
    if p.SchedulerInstanceCount != 1 {
        t.Fatal(p)
    }
    if err := a.SetEnabled(ctx, false); err != nil {
        t.Fatal(err)
    }

    running, cancel := context.WithCancel(ctx)
    defer cancel()
    finished := make(chan error, 1)
    before := p.Heartbeats[0].LastHeartbeatAt
    go func() { finished <- a.Run(running) }()
    deadline := time.Now().Add(3 * time.Second)
    for query().Heartbeats[0].LastHeartbeatAt <= before {
        if time.Now().After(deadline) {
            t.Fatal("等待运行中的调度器心跳超时")
        }
        time.Sleep(10 * time.Millisecond)
    }

    cancel()
    select {
    case err := <-finished:
        if err != nil {
            t.Fatal(err)
        }
    case <-time.After(3 * time.Second):
        t.Fatal("等待调度器正常退出超时")
    }

    p = query()
    if p.SchedulerInstanceCount != 0 || p.SchedulerLeader != nil || p.Schedules[0].NextRunAt != nil {
        t.Fatal(p)
    }

    fail = false
    if err := b.Tick(ctx); err != nil {
        t.Fatal(err)
    }

    p = query()
    if p.SchedulerLeader == nil || *p.SchedulerLeader != b.instanceID() {
        t.Fatal("备用调度器接管", p)
    }

    empty, err := Dashboard(ctx, r, cfg, nil)
    if err != nil || empty.ScheduleCount != 0 || empty.Schedules == nil {
        t.Fatal(empty, err)
    }
}

func TestSchedulesDashboardDefaultsAndLegacyRedis(t *testing.T) {
    r, prefix := testredis.Open(t)
    ctx := context.Background()
    cfg := queue.Config{Namespace: prefix, Instance: "defaults"}
    d := Definition{
        Name:             "enabled",
        Expression:       "0 9 * * *",
        Timezone:         "Asia/Shanghai",
        EnabledByDefault: true,
    }
    key := cfg.Key("schedule-state:" + d.Name)
    t.Cleanup(func() { _ = r.Del(ctx, key).Err() })
    p, err := Dashboard(ctx, r, cfg, []Definition{d})
    if err != nil || !p.Schedules[0].Enabled || p.Schedules[0].NextRunAt == nil || p.Schedules[0].Status != "idle" {
        t.Fatal(p, err)
    }
    if err := r.HSet(ctx, key, "lastDispatchedAt", "1700000000000", "lastAttemptAt", "1700000001000", "lastResult", "dispatch_failed").Err(); err != nil {
        t.Fatal(err)
    }

    p, err = Dashboard(ctx, r, cfg, []Definition{d})
    if err != nil || p.Schedules[0].Status != "dispatch_failed" || p.Schedules[0].LastActivityAt == nil || *p.Schedules[0].LastActivityAt != 1700000000000 {
        t.Fatal("最近活动沿用 Node.js 成功派发时间优先规则", p, err)
    }
    if err := r.HDel(ctx, key, "lastResult").Err(); err != nil {
        t.Fatal(err)
    }
    if err := r.HSet(ctx, key, "lastDispatchedAt", "1700000000000").Err(); err != nil {
        t.Fatal(err)
    }

    p, err = Dashboard(ctx, r, cfg, []Definition{d})
    if err != nil || p.Schedules[0].Status != "dispatched" || p.Schedules[0].LastActivityAt == nil || *p.Schedules[0].LastActivityAt != 1700000000000 {
        t.Fatal(p, err)
    }
}

func TestSchedulesDashboardNoFutureRunRedis(t *testing.T) {
    r, prefix := testredis.Open(t)
    d := Definition{
        Name:             "no-future-slot",
        Expression:       "0 0 31 2 *",
        Timezone:         "Asia/Shanghai",
        EnabledByDefault: true,
    }
    p, err := Dashboard(context.Background(), r, queue.Config{Namespace: prefix}, []Definition{d})
    if err != nil || !p.Schedules[0].Enabled || p.Schedules[0].NextRunAt != nil {
        t.Fatal("未来执行槽为空时保持空时间", p, err)
    }
}
