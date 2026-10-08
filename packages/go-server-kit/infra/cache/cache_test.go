package cache_test

// 本文件覆盖Redis 缓存命中、缺失、TTL 与隔离键的删除。

import (
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/cache"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/internal/testredis"
    "context"
    "testing"
    "time"
)

func TestCacheRedis(t *testing.T) {
    r, prefix := testredis.Open(t)
    ctx := context.Background()
    one, two := subject.Store{Redis: r, Prefix: prefix + "-a"}, subject.Store{Redis: r, Prefix: prefix + "-b"}
    var got map[string]int
    if err := one.Set(ctx, "value", map[string]int{"n": 42}, 150*time.Millisecond); err != nil {
        t.Fatal(err)
    }
    if ok, err := one.Get(ctx, "value", &got); err != nil || !ok || got["n"] != 42 {
        t.Fatal(ok, err, got)
    }
    if ok, err := two.Get(ctx, "value", &got); err != nil || ok {
        t.Fatal("命名空间隔离", ok, err)
    }
    testredis.Wait(t, func() bool {
        ok, err := one.Get(ctx, "value", &got)
        return err == nil && !ok
    })
    if err := one.Set(ctx, "value", got, time.Minute); err != nil {
        t.Fatal(err)
    }
    if err := one.Delete(ctx, "value"); err != nil {
        t.Fatal(err)
    }
    if ok, err := one.Get(ctx, "value", &got); err != nil || ok {
        t.Fatal(ok, err)
    }

    for _, ttl := range []time.Duration{0, -time.Second} {
        if one.Set(ctx, "value", got, ttl) == nil {
            t.Fatal("TTL 校验")
        }
    }

    if err := r.Set(ctx, prefix+"-a:value", "invalid-json", time.Minute).Err(); err != nil {
        t.Fatal(err)
    }
    if _, err := one.Get(ctx, "value", &got); err == nil {
        t.Fatal("损坏缓存应返回错误")
    }
    if _, err := (subject.Store{Redis: r}).Get(ctx, "value", &got); err == nil {
        t.Fatal("命名空间校验")
    }
}
