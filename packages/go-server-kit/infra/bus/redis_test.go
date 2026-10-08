package bus_test

// 本文件覆盖Redis 订阅配额、终止及清理生命周期，并验证消息信封的严格协议边界。

import (
    "context"
    "encoding/json"
    "errors"
    "os"
    "testing"
    "time"

    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/bus"
    "github.com/google/uuid"
    "github.com/redis/go-redis/v9"
)

func testBus(t *testing.T, queue int) *subject.Redis {
    t.Helper()
    url := os.Getenv("REDIS_TEST_URL")
    if url == "" {
        t.Skip("Redis 集成测试需要 REDIS_TEST_URL")
    }

    options, err := redis.ParseURL(url)
    if err != nil {
        t.Fatal(err)
    }

    options.MaxRetries = -1
    options.ContextTimeoutEnabled = true
    client := redis.NewClient(options)
    b, err := subject.New(client, subject.Config{
        Prefix:           "test-" + uuid.NewString(),
        Environment:      "default",
        Name:             "bus-demo",
        Queue:            queue,
        MaxSubscriptions: 2,
        OperationTimeout: 300 * time.Millisecond,
    })
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() {
        b.Close()
        _ = client.Close()
    })
    return b
}

func wait(t *testing.T, s *subject.Subscription) {
    t.Helper()
    select {
    case <-s.Done:
    case <-time.After(2 * time.Second):
        t.Fatal("订阅清理超时")
    }
}

func TestRedisSubscription(t *testing.T) {
    t.Run("ack-before-publish-and-idempotent-cleanup", func(t *testing.T) {
        b := testBus(t, 2)
        ctx, cancel := context.WithCancel(context.Background())
        s, err := b.Subscribe(ctx, "topic")
        if err != nil {
            t.Fatal(err)
        }

        id, err := b.Publish(ctx, "topic", map[string]string{"message": "你好"})
        if err != nil {
            t.Fatal(err)
        }

        select {
        case message := <-s.Messages:
            if message.ID != id || message.Topic != "topic" {
                t.Fatal(message)
            }
        case <-time.After(time.Second):
            t.Fatal("订阅确认后未收到消息")
        }

        cancel()
        wait(t, s)
        s.Close()
        s.Close()
        if b.Active() != 0 {
            t.Fatal("订阅残留")
        }
    })
    t.Run("bounded-overflow", func(t *testing.T) {
        b := testBus(t, 1)
        s, err := b.Subscribe(context.Background(), "topic")
        if err != nil {
            t.Fatal(err)
        }

        for i := 0; i < 4; i++ {
            if _, err = b.Publish(context.Background(), "topic", i); err != nil {
                t.Fatal(err)
            }
        }

        wait(t, s)
        if !errors.Is(s.Err(), subject.ErrOverflow) {
            t.Fatal(s.Err())
        }
        if b.Active() != 0 {
            t.Fatal("overflow 订阅残留")
        }
    })
    t.Run("invalid-envelope-fail-closed", func(t *testing.T) {
        b := testBus(t, 1)
        s, err := b.Subscribe(context.Background(), "topic")
        if err != nil {
            t.Fatal(err)
        }

        channel, _ := b.Channel("topic")
        if err = b.Client.Publish(context.Background(), channel, `{"version":9}`).Err(); err != nil {
            t.Fatal(err)
        }
        wait(t, s)
        if !errors.Is(s.Err(), subject.ErrProtocol) {
            t.Fatal(s.Err())
        }
    })
    t.Run("subscription-quota", func(t *testing.T) {
        b := testBus(t, 1)
        s, err := b.Subscribe(context.Background(), "one")
        if err != nil {
            t.Fatal(err)
        }
        defer s.Close()
        s2, err := b.Subscribe(context.Background(), "two")
        if err != nil {
            t.Fatal(err)
        }
        defer s2.Close()
        if _, err = b.Subscribe(context.Background(), "three"); err == nil {
            t.Fatal("配额未生效")
        }
    })
    t.Run("connection-loss-and-new-subscription", func(t *testing.T) {
        b := testBus(t, 2)
        s, err := b.Subscribe(context.Background(), "topic")
        if err != nil {
            t.Fatal(err)
        }
        if err = b.Client.Do(context.Background(), "CLIENT", "KILL", "TYPE", "pubsub").Err(); err != nil {
            t.Fatal(err)
        }
        wait(t, s)
        if s.Err() == nil {
            t.Fatal("连接断开未记录错误")
        }

        next, err := b.Subscribe(context.Background(), "topic")
        if err != nil {
            t.Fatal(err)
        }
        defer next.Close()
        _, err = b.Publish(context.Background(), "topic", true)
        if err != nil {
            t.Fatal(err)
        }

        select {
        case <-next.Messages:
        case <-time.After(time.Second):
            t.Fatal("新订阅恢复失败")
        }
    })
    t.Run("presence-crash-ttl", func(t *testing.T) {
        b := testBus(t, 1)
        ctx := context.Background()
        if err := b.PresenceRefresh(ctx, "crashed", 80*time.Millisecond); err != nil {
            t.Fatal(err)
        }
        if n, err := b.PresenceCount(ctx); err != nil || n != 1 {
            t.Fatal(n, err)
        }
        time.Sleep(110 * time.Millisecond)
        if n, err := b.PresenceCount(ctx); err != nil || n != 0 {
            t.Fatal(n, err)
        }
    })
    t.Run("close-racing-subscribe", func(t *testing.T) {
        b := testBus(t, 1)
        done := make(chan struct{})
        go func() {
            defer close(done)
            for i := 0; i < 10; i++ {
                s, err := b.Subscribe(context.Background(), "topic")
                if err == nil {
                    s.Close()
                }
            }
        }()
        b.Close()
        _ = b.Client.Close()
        <-done
        if b.Active() != 0 {
            t.Fatal("并发退出有订阅残留")
        }
        if _, err := b.Publish(context.Background(), "topic", nil); !errors.Is(err, subject.ErrClosed) {
            t.Fatal(err)
        }
    })
}

func TestEnvelopeValidation(t *testing.T) {
    valid := subject.Envelope{
        Version:     1,
        ID:          "message",
        Topic:       "topic",
        PublishedAt: 1,
        Payload:     json.RawMessage(`{"ok":true}`),
    }
    raw, _ := json.Marshal(valid)
    if _, err := subject.Decode(raw); err != nil {
        t.Fatal(err)
    }

    for _, raw := range []string{
        `{"version":1,"id":"i","topic":"t","payload":null}`,
        `{"version":1,"id":"i","topic":"t","publishedAt":null,"payload":null}`,
        `{"version":1,"id":"i","topic":"t","publishedAt":-1,"payload":null}`,
        `{"version":1,"id":"i","topic":"t","publishedAt":1,"payload":null,"extra":1}`,
    } {
        if _, err := subject.Decode([]byte(raw)); err == nil {
            t.Fatalf("无效信封通过: %s", raw)
        }
    }
}
