package server

// 本文件覆盖Redis 停止、进程崩溃后的设备 TTL 与优雅关闭。

import (
    "context"
    "encoding/json"
    "io"
    "net/http"
    "os"
    "strconv"
    "syscall"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/protocol"
)

func external(t *testing.T) (string, string) {
    t.Helper()
    a, b := os.Getenv("TEST_WEB_A"), os.Getenv("TEST_WEB_B")
    if a == "" || b == "" {
        t.Skip("需要外部 Web 进程")
    }
    return a, b
}

func signalOwned(t *testing.T, key string, signal syscall.Signal) {
    t.Helper()
    pid, err := strconv.Atoi(os.Getenv(key))
    if err != nil || pid <= 1 {
        t.Fatal("缺少脚本创建的进程 PID", key)
    }

    process, err := os.FindProcess(pid)
    if err != nil {
        t.Fatal(err)
    }
    if err = process.Signal(signal); err != nil {
        t.Fatal(err)
    }
}

func TestExternalRedisStop(t *testing.T) {
    a, b := external(t)
    device := dial(t, b, QuerySocketPath)
    broadcast := dial(t, a, BroadcastSocketPath)
    response := post(t, a, QueryPath, queryInput())
    _ = command(t, device)
    signalOwned(t, "TEST_REDIS_PID", syscall.SIGTERM)
    expectError(t, readEvents(t, response), "BUS_UNAVAILABLE")
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()
    if _, _, err := broadcast.Read(ctx); err == nil {
        t.Fatal("Redis 中断后广播连接仍开放")
    }

    _ = device.CloseNow()
    _ = broadcast.CloseNow()
    response = post(t, a, BroadcastPath, protocol.Broadcast{MessageBody: "Redis 停机"})
    raw, _ := io.ReadAll(response.Body)
    _ = response.Body.Close()
    var value map[string]string
    _ = json.Unmarshal(raw, &value)
    if response.StatusCode != 503 || value["error"] != "Bus 发布失败，请检查后端连接状态。" {
        t.Fatal(response.StatusCode, string(raw))
    }
}

func TestExternalCrashTTL(t *testing.T) {
    a, b := external(t)
    device := dial(t, a, QuerySocketPath)
    response := post(t, b, QueryPath, queryInput())
    _ = command(t, device)
    start := time.Now()
    signalOwned(t, "TEST_WEB_A_PID", syscall.SIGKILL)
    expectError(t, readEvents(t, response), "DEVICE_DISCONNECTED")
    if time.Since(start) > 4*time.Second {
        t.Fatal("崩溃设备 TTL 淘汰超时")
    }

    _ = device.CloseNow()
    response = post(t, b, QueryPath, queryInput())
    expectError(t, readEvents(t, response), "DEVICE_OFFLINE")
}

func TestExternalShutdown(t *testing.T) {
    a, b := external(t)
    device := dial(t, b, QuerySocketPath)
    broadcast := dial(t, a, BroadcastSocketPath)
    response := post(t, a, QueryPath, queryInput())
    _ = command(t, device)
    signalOwned(t, "TEST_WEB_A_PID", syscall.SIGTERM)
    events := readEvents(t, response)
    if len(events) != 1 || events[0].kind != "ready" {
        t.Fatal(events)
    }

    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()
    if _, _, err := broadcast.Read(ctx); err == nil {
        t.Fatal("Web SIGTERM 后 WS 仍开放")
    }

    _ = broadcast.CloseNow()
    _ = device.CloseNow()
    // 幸存实例仍提供普通 HTTP。
    health, err := http.Get(b + "/api/rest/internal/health")
    if err != nil {
        t.Fatal(err)
    }

    _ = health.Body.Close()
    if health.StatusCode != 200 {
        t.Fatal(health.StatusCode)
    }
}
