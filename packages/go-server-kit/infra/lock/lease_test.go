package lock_test

// 本文件覆盖租约竞争、续期和按持有者 token 释放。

import (
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/lock"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/internal/testredis"
    "context"
    "testing"
    "time"
)

func TestLeaseRedis(t *testing.T) {
    r, key := testredis.Open(t)
    ctx := context.Background()
    a := subject.Lease{
        Redis: r,
        Key:   key,
        Token: "owner-a",
        TTL:   120 * time.Millisecond,
    }
    b := subject.Lease{Redis: r, Key: key, Token: "owner-b", TTL: time.Second}
    if ok, err := a.Acquire(ctx); err != nil || !ok {
        t.Fatal(ok, err)
    }
    if ok, err := b.Acquire(ctx); err != nil || ok {
        t.Fatal("持有者互斥", ok, err)
    }
    if err := b.Release(ctx); err != nil {
        t.Fatal(err)
    }
    if ok, err := a.Owned(ctx); err != nil || !ok {
        t.Fatal("持有者保护", ok, err)
    }
    if ok, err := a.Acquire(ctx); err != nil || !ok {
        t.Fatal("续租", ok, err)
    }
    testredis.Wait(t, func() bool {
        ok, err := b.Acquire(ctx)
        return err == nil && ok
    })
    if err := a.Release(ctx); err != nil {
        t.Fatal(err)
    }
    if ok, err := a.Acquire(ctx); err != nil || ok {
        t.Fatal("过期持有者保护", ok, err)
    }
    if err := b.Release(ctx); err != nil {
        t.Fatal(err)
    }
    if ok, err := b.Owned(ctx); err != nil || ok {
        t.Fatal(ok, err)
    }
    if _, err := (subject.Lease{}).Acquire(ctx); err == nil {
        t.Fatal("空租约校验")
    }
}
