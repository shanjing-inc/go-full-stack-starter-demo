// Package testredis 为集成测试提供独立客户端和随机命名空间。
package testredis

import (
    "context"
    "github.com/google/uuid"
    "github.com/redis/go-redis/v9"
    "os"
    "testing"
    "time"
)

// Open 读取 REDIS_TEST_URL 并返回独立客户端和随机前缀，缺少配置时跳过测试。
func Open(t *testing.T) (*redis.Client, string) {
    t.Helper()
    url := os.Getenv("REDIS_TEST_URL")
    if url == "" {
        t.Skip("需要隔离 REDIS_TEST_URL")
    }

    opt, err := redis.ParseURL(url)
    if err != nil {
        t.Fatal(err)
    }

    opt.DialTimeout = time.Second
    opt.ReadTimeout = time.Second
    opt.WriteTimeout = time.Second
    client := redis.NewClient(opt)
    t.Cleanup(func() { _ = client.Close() })
    if err := client.Ping(context.Background()).Err(); err != nil {
        t.Fatal(err)
    }
    return client, "test-" + uuid.NewString()
}

// Wait 在八秒期限内轮询条件，超时使当前测试失败。
func Wait(t *testing.T, fn func() bool) {
    t.Helper()
    deadline := time.Now().Add(8 * time.Second)
    for time.Now().Before(deadline) {
        if fn() {
            return
        }
        time.Sleep(20 * time.Millisecond)
    }

    t.Fatal("等待集成测试条件超时")
}
