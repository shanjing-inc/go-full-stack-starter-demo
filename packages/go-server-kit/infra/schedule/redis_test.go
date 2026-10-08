package schedule_test

// 本文件覆盖共享调度开关、租约与 Redis 驱动的幂等投递。

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/lock"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/schedule"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/internal/testredis"
    "context"
    "testing"
    "time"
)

func TestSchedulerRedis(t *testing.T) {
    r, prefix := testredis.Open(t)
    ctx := context.Background()
    d := subject.Definition{
        Name:             "tick",
        Expression:       "@every 1s",
        Timezone:         "Asia/Shanghai",
        EnabledByDefault: false,
    }
    parsed, err := d.Parse()
    if err != nil {
        t.Fatal(err)
    }

    create := func(token string) *subject.Scheduler {
        return &subject.Scheduler{
            Config:     queue.Config{Namespace: prefix, Instance: token},
            Redis:      r,
            Definition: d,
            Parsed:     parsed,
            Lease: lock.Lease{
                Redis: r,
                Key:   prefix + ":leader",
                Token: token,
                TTL:   time.Second,
            },
            Enqueue: func(ctx context.Context, key string) (bool, error) {
                return r.HSetNX(ctx, prefix+":dispatched", key, token).Result()
            },
        }
    }
    a, b := create("a"), create("b")
    if err := a.Initialize(ctx); err != nil {
        t.Fatal(err)
    }
    if err := b.Initialize(ctx); err != nil {
        t.Fatal(err)
    }
    if err := a.Tick(ctx); err != nil {
        t.Fatal(err)
    }
    if n := r.HLen(ctx, prefix+":dispatched").Val(); n != 0 {
        t.Fatal("默认关闭", n)
    }
    if err := b.SetEnabled(ctx, true); err != nil {
        t.Fatal(err)
    }
    if enabled, err := a.Enabled(ctx); err != nil || !enabled {
        t.Fatal("共享开关", enabled, err)
    }
    if err := a.Tick(ctx); err != nil {
        t.Fatal(err)
    }
    if err := b.Tick(ctx); err != nil {
        t.Fatal(err)
    }
    if leader := r.Get(ctx, prefix+":leader").Val(); leader != "a" {
        t.Fatal(leader)
    }
    if ok, err := a.Manual(ctx, "request-1"); err != nil || !ok {
        t.Fatal(ok, err)
    }
    if ok, err := b.Manual(ctx, "request-1"); err != nil || ok {
        t.Fatal("手动幂等", ok, err)
    }
    if err := a.Lease.Release(ctx); err != nil {
        t.Fatal(err)
    }
    time.Sleep(1100 * time.Millisecond)
    if err := b.Tick(ctx); err != nil {
        t.Fatal(err)
    }
    if leader := r.Get(ctx, prefix+":leader").Val(); leader != "b" {
        t.Fatal("Leader 接管", leader)
    }
    if leader := r.HGet(ctx, b.Config.Key("schedule-state:tick"), "leader").Val(); leader != "b" {
        t.Fatal("派发状态", leader)
    }
    if err := a.SetEnabled(ctx, false); err != nil {
        t.Fatal(err)
    }
    if enabled, err := b.Enabled(ctx); err != nil || enabled {
        t.Fatal("共享停用", enabled, err)
    }
    if err := b.Lease.Release(ctx); err != nil {
        t.Fatal(err)
    }
}
