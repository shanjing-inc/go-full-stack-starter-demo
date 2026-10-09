package server

// 本文件覆盖会话失效与用户管理操作对存量长连接的撤销，以及无效设备回执的阻断。

import (
    "context"
    "encoding/json"
    "errors"
    "net/http"
    "net/http/httptest"
    "os"
    "path/filepath"
    "strings"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/bus"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/protocol"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
    web "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
    "github.com/coder/websocket"
    "github.com/google/uuid"
    "github.com/redis/go-redis/v9"
    "gorm.io/gorm"
)

type authenticatedSocket struct {
    db   *gorm.DB
    auth *auth.Service
    bus  *bus.Redis
    conn *websocket.Conn
}

func newAuthenticatedSocket(t *testing.T, path string, refresh time.Duration) authenticatedSocket {
    t.Helper()
    redisURL := os.Getenv("REDIS_TEST_URL")
    if redisURL == "" {
        t.Skip("需要隔离 Redis")
    }

    ctx := context.Background()
    // 两个独立连接模拟跨实例读写，使用 WAL 与有界锁等待保证并发夹具稳定。
    dsn := filepath.Join(t.TempDir(), "session.sqlite") + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
    db, err := database.Open(ctx, "sqlite", dsn)
    if err != nil {
        t.Fatal(err)
    }

    sql, _ := db.DB()
    t.Cleanup(func() { _ = sql.Close() })
    if err = db.AutoMigrate(auth.Models()...); err != nil {
        t.Fatal(err)
    }

    role := "admin"
    user := auth.User{
        ID:    1,
        Name:  "长连接回归用户",
        Email: "socket@example.test",
        Role:  &role,
    }
    if err = db.Create(&user).Error; err != nil {
        t.Fatal(err)
    }
    if err = db.Create(&auth.Session{
        UserID:    1,
        Token:     "test-live-token",
        ExpiresAt: time.Now().Add(time.Hour).UTC(),
    }).Error; err != nil {
        t.Fatal(err)
    }

    authentication, err := auth.New(db, auth.Config{
        Secret:  "test-secret-at-least-32-bytes-long",
        Origins: []string{"http://socket.test"},
        PathPermissions: map[string]auth.Permission{
            QuerySocketPath:     {Resource: "shop", Action: "list"},
            BroadcastSocketPath: {Resource: "shop", Action: "list"},
        },
    })
    if err != nil {
        t.Fatal(err)
    }
    // 独立数据库连接和 Service 模拟其他实例撤销会话。
    otherDB, err := database.Open(ctx, "sqlite", dsn)
    if err != nil {
        t.Fatal(err)
    }

    otherSQL, _ := otherDB.DB()
    t.Cleanup(func() { _ = otherSQL.Close() })
    for _, connection := range []*gorm.DB{db, otherDB} {
        var mode string
        if err := connection.Raw("PRAGMA journal_mode").Scan(&mode).Error; err != nil || mode != "wal" {
            t.Fatalf("长连接夹具 WAL 配置: %q, %v", mode, err)
        }

        var timeout int
        if err := connection.Raw("PRAGMA busy_timeout").Scan(&timeout).Error; err != nil || timeout != 5000 {
            t.Fatalf("长连接夹具锁等待配置: %d, %v", timeout, err)
        }
    }

    other, err := auth.New(otherDB, auth.Config{Secret: "test-secret-at-least-32-bytes-long"})
    if err != nil {
        t.Fatal(err)
    }

    options, err := redis.ParseURL(redisURL)
    if err != nil {
        t.Fatal(err)
    }

    client := redis.NewClient(options)
    t.Cleanup(func() { _ = client.Close() })
    b, err := bus.New(client, bus.Config{
        Prefix:      "socket-session-" + uuid.NewString(),
        Environment: "test",
        Name:        "session",
    })
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(b.Close)
    config := Defaults()
    config.Origins = []string{"http://socket.test"}
    config.DeviceRefresh = refresh
    config.DeviceTTL = refresh * 3
    api, runtime, err := Register(web.New(service.NewMemory(nil), web.Config{Authentication: authentication}), b, config)
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(runtime.Close)
    api.Use(authentication.Guard)
    server := httptest.NewServer(api)
    t.Cleanup(server.Close)
    dial, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()
    conn, _, err := websocket.Dial(dial, strings.Replace(server.URL, "http://", "ws://", 1)+path, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer test-live-token"}, "Origin": []string{"http://socket.test"}}})
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { _ = conn.CloseNow() })
    if message := readWS(t, conn); message.Type != "ready" {
        t.Fatal(message)
    }
    if path == QuerySocketPath {
        if message := readWS(t, conn); message.Type != "bus.query.ready" {
            t.Fatal(message)
        }
    }
    return authenticatedSocket{db, other, b, conn}
}

func invalidateSocket(t *testing.T, fixture authenticatedSocket, mode string) {
    t.Helper()
    var err error
    switch mode {
    case "其他实例退出":
        err = fixture.auth.Logout(context.Background(), "test-live-token")
    case "封禁":
        err = fixture.db.Model(&auth.User{}).Where("id = 1").Update("banned", true).Error
    case "过期":
        err = fixture.db.Model(&auth.Session{}).Where("user_id = 1").Update("expires_at", time.Now().Add(-time.Hour).UTC()).Error
    case "角色变更":
        err = fixture.db.Model(&auth.User{}).Where("id = 1").Update("role", "member").Error
    }

    if err != nil {
        t.Fatal(err)
    }
}

func assertSocketClosed(t *testing.T, conn *websocket.Conn) {
    t.Helper()
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    _, raw, err := conn.Read(ctx)
    if err == nil {
        t.Fatalf("失效连接仍收到数据：%s", raw)
    }
    if errors.Is(err, context.DeadlineExceeded) {
        t.Fatal("会话失效后连接仍保持空闲")
    }
}

func waitDeviceRemoved(t *testing.T, b *bus.Redis) {
    t.Helper()
    deadline := time.Now().Add(time.Second)
    for time.Now().Before(deadline) {
        count, err := b.PresenceCount(context.Background())
        if err != nil {
            t.Fatal(err)
        }
        if count == 0 {
            return
        }
        time.Sleep(10 * time.Millisecond)
    }

    t.Fatal("失效设备仍保留 presence")
}

func TestWebSocketSessionInvalidation(t *testing.T) {
    for _, path := range []string{BroadcastSocketPath, QuerySocketPath} {
        for _, mode := range []string{"其他实例退出", "封禁", "过期", "角色变更"} {
            for _, activity := range []string{"空闲检查", "发送复核"} {
                t.Run(path+"/"+mode+"/"+activity, func(t *testing.T) {
                    refresh := 30 * time.Millisecond
                    if activity == "发送复核" {
                        refresh = 2 * time.Second
                    }

                    f := newAuthenticatedSocket(t, path, refresh)
                    invalidateSocket(t, f, mode)
                    if activity == "发送复核" {
                        topic := protocol.BroadcastTopic
                        var payload any = protocol.Broadcast{MessageBody: "失效后的广播"}
                        if path == QuerySocketPath {
                            topic = protocol.QueryTopic
                            payload = protocol.Command{
                                Type:        "bus.query.execute",
                                RequestID:   uuid.NewString(),
                                ResponseKey: uuid.NewString(),
                                Content:     "失效后的设备指令",
                            }
                        }
                        if _, err := f.bus.Publish(context.Background(), topic, payload); err != nil {
                            t.Fatal(err)
                        }
                    }
                    assertSocketClosed(t, f.conn)
                    if path == QuerySocketPath {
                        waitDeviceRemoved(t, f.bus)
                    }
                })
            }
        }
    }
}

func TestInvalidDeviceCannotPublishReceipt(t *testing.T) {
    for _, kind := range []string{"bus.query.result", "bus.query.error"} {
        t.Run(kind, func(t *testing.T) {
            f := newAuthenticatedSocket(t, QuerySocketPath, 2*time.Second)
            responseKey, requestID := uuid.NewString(), uuid.NewString()
            ctx, cancel := context.WithTimeout(context.Background(), time.Second)
            defer cancel()
            sub, err := f.bus.Subscribe(ctx, protocol.ResultTopic(responseKey))
            if err != nil {
                t.Fatal(err)
            }
            defer sub.Close()
            invalidateSocket(t, f, "其他实例退出")
            payload := map[string]any{"requestId": requestID, "responseKey": responseKey}
            if kind == "bus.query.result" {
                payload["content"], payload["index"], payload["total"] = "有效格式的回执", 1, 1
            } else {
                payload["message"] = "有效格式的错误回执"
            }

            fields := map[string]any{"type": kind}
            for key, value := range payload {
                fields[key] = value
            }

            receiptRaw, _ := json.Marshal(fields)
            if _, err = protocol.ParseReceipt(receiptRaw); err != nil {
                t.Fatal("回执测试夹具", err)
            }

            raw, _ := json.Marshal(map[string]any{"type": kind, "payload": payload})
            if err = f.conn.Write(ctx, websocket.MessageText, raw); err != nil {
                t.Fatal(err)
            }
            assertSocketClosed(t, f.conn)
            select {
            case message := <-sub.Messages:
                t.Fatal("已发布失效回执", message)
            case <-time.After(100 * time.Millisecond):
            }

            waitDeviceRemoved(t, f.bus)
        })
    }
}

func TestManagedUserOperationsCloseLiveConnections(t *testing.T) {
    for _, path := range []string{BroadcastSocketPath, QuerySocketPath} {
        for _, operation := range []string{"撤销全部会话", "封禁用户", "修改角色"} {
            t.Run(path+"/"+operation, func(t *testing.T) {
                f := newAuthenticatedSocket(t, path, 30*time.Millisecond)
                if err := f.db.Create(&auth.Bootstrap{ID: 1}).Error; err != nil {
                    t.Fatal(err)
                }

                role := "owner"
                actor := &auth.User{
                    ID:    2,
                    Name:  "管理操作者",
                    Email: "manager@example.test",
                    Role:  &role,
                }
                if err := f.db.Create(actor).Error; err != nil {
                    t.Fatal(err)
                }

                ctx := auth.WithUser(context.Background(), actor)
                var err error
                switch operation {
                case "撤销全部会话":
                    err = f.auth.RevokeUserSessions(ctx, 1)
                case "封禁用户":
                    value := true
                    _, err = f.auth.UpdateUsers(ctx, auth.UserFilters{ID: &auth.IntCondition{Eq: intPointer(1)}}, auth.UpdateUserInput{Banned: &value})
                case "修改角色":
                    value := "member"
                    _, err = f.auth.UpdateUsers(ctx, auth.UserFilters{ID: &auth.IntCondition{Eq: intPointer(1)}}, auth.UpdateUserInput{Role: &value})
                }

                if err != nil {
                    t.Fatal(err)
                }
                assertSocketClosed(t, f.conn)
                if path == QuerySocketPath {
                    waitDeviceRemoved(t, f.bus)
                }
            })
        }
    }
}

func intPointer(value int) *int { return &value }
