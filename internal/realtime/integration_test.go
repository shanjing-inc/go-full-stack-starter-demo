package server

// 本文件覆盖实时查询与广播，以及多 Web 进程联动。

import (
    "bufio"
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "net/http/httptest"
    "os"
    "strings"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/bus"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/protocol"
    "github.com/coder/websocket"
    "github.com/google/uuid"
    "github.com/redis/go-redis/v9"
)

type pair struct {
    a, b     string
    one, two *Runtime
}

func newPair(t *testing.T, change func(*Config)) *pair {
    t.Helper()
    url := os.Getenv("REDIS_TEST_URL")
    if url == "" {
        t.Skip("需要隔离 Redis")
    }

    config := Defaults()
    config.QueryTimeout = 450 * time.Millisecond
    config.Heartbeat = 40 * time.Millisecond
    config.DeviceTTL = 200 * time.Millisecond
    config.DeviceRefresh = 40 * time.Millisecond
    config.WriteTimeout = 200 * time.Millisecond
    if change != nil {
        change(&config)
    }

    prefix := "server-test-" + uuid.NewString()
    create := func() (string, *Runtime) {
        options, err := redis.ParseURL(url)
        if err != nil {
            t.Fatal(err)
        }

        options.MaxRetries = -1
        options.ContextTimeoutEnabled = true
        options.DialTimeout = 200 * time.Millisecond
        options.ReadTimeout = 300 * time.Millisecond
        b, err := bus.New(redis.NewClient(options), bus.Config{
            Prefix:           prefix,
            Environment:      "default",
            Name:             "bus-demo",
            OperationTimeout: 250 * time.Millisecond,
        })
        if err != nil {
            t.Fatal(err)
        }

        e, r, err := New(b, config)
        if err != nil {
            t.Fatal(err)
        }

        s := httptest.NewServer(e)
        t.Cleanup(func() {
            r.Close()
            s.Close()
            b.Close()
            _ = b.Client.Close()
        })
        return s.URL, r
    }
    a, one := create()
    b, two := create()
    return &pair{a, b, one, two}
}

func dial(t *testing.T, base, path string) *websocket.Conn {
    t.Helper()
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    ws, _, err := websocket.Dial(ctx, strings.Replace(base, "http://", "ws://", 1)+path, &websocket.DialOptions{HTTPHeader: externalHeaders(base)})
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { _ = ws.CloseNow() })
    message := readWS(t, ws)
    if message.Type != "ready" {
        t.Fatalf("ready: %+v", message)
    }
    if path == QuerySocketPath {
        if message = readWS(t, ws); message.Type != "bus.query.ready" {
            t.Fatalf("query ready: %+v", message)
        }
    }
    return ws
}

func readWS(t *testing.T, ws *websocket.Conn) protocol.ClientMessage {
    t.Helper()
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    kind, raw, err := ws.Read(ctx)
    if err != nil {
        t.Fatal(err)
    }
    if kind != websocket.MessageText {
        t.Fatal("消息类型")
    }

    var message protocol.ClientMessage
    if err = json.Unmarshal(raw, &message); err != nil {
        t.Fatal(err)
    }

    var stamp struct {
        SentAt string `json:"sentAt"`
    }
    _ = json.Unmarshal(raw, &stamp)
    if _, err = time.Parse("2006-01-02T15:04:05.000Z", stamp.SentAt); err != nil {
        t.Fatal("时间戳格式", stamp.SentAt)
    }
    return message
}

func writeWS(t *testing.T, ws *websocket.Conn, kind string, payload any) {
    t.Helper()
    raw, _ := json.Marshal(map[string]any{"type": kind, "payload": payload})
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    if err := ws.Write(ctx, websocket.MessageText, raw); err != nil {
        t.Fatal(err)
    }
}

func post(t *testing.T, base, path string, value any) *http.Response {
    t.Helper()
    raw, _ := json.Marshal(value)
    request, err := http.NewRequest("POST", base+path, bytes.NewReader(raw))
    if err != nil {
        t.Fatal(err)
    }
    request.Header.Set("Content-Type", "application/json")
    for key, values := range externalHeaders(base) {
        request.Header[key] = values
    }

    client := &http.Client{Timeout: 3 * time.Second}
    response, err := client.Do(request)
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { _ = response.Body.Close() })
    return response
}

type event struct {
    kind string
    data json.RawMessage
}

func readEvents(t *testing.T, response *http.Response) []event {
    t.Helper()
    events := []event{}
    scan := bufio.NewScanner(response.Body)
    value := event{}
    for scan.Scan() {
        line := scan.Text()
        if strings.HasPrefix(line, "event: ") {
            value.kind = strings.TrimPrefix(line, "event: ")
        }
        if strings.HasPrefix(line, "data: ") {
            value.data = json.RawMessage(strings.TrimPrefix(line, "data: "))
        }
        if line == "" && value.kind != "" {
            events = append(events, value)
            value = event{}
        }
    }

    if err := scan.Err(); err != nil {
        t.Fatal(err)
    }
    return events
}

func expectError(t *testing.T, events []event, code string) {
    t.Helper()
    if len(events) != 3 || events[0].kind != "ready" || events[1].kind != "error" || events[2].kind != "done" {
        t.Fatalf("事件: %+v", events)
    }

    var value struct {
        Code string `json:"code"`
    }
    _ = json.Unmarshal(events[1].data, &value)
    if value.Code != code {
        t.Fatalf("错误码 %q, 期望 %q", value.Code, code)
    }
}

func clean(t *testing.T, p *pair) {
    t.Helper()
    deadline := time.Now().Add(2 * time.Second)
    for time.Now().Before(deadline) {
        p.one.mu.Lock()
        a := len(p.one.sessions)
        p.one.mu.Unlock()
        p.two.mu.Lock()
        b := len(p.two.sessions)
        p.two.mu.Unlock()
        if a == 0 && b == 0 && p.one.Bus.Active() == 0 && p.two.Bus.Active() == 0 {
            return
        }
        time.Sleep(10 * time.Millisecond)
    }

    t.Fatal("实时会话或 Bus 订阅残留")
}

func command(t *testing.T, ws *websocket.Conn) protocol.Command {
    t.Helper()
    message := readWS(t, ws)
    if message.Type != "bus.query.execute" {
        t.Fatalf("command: %+v", message)
    }

    var c protocol.Command
    if err := json.Unmarshal(message.Payload, &c); err != nil {
        t.Fatal(err)
    }

    c.Type = message.Type
    return c
}

func result(t *testing.T, ws *websocket.Conn, c protocol.Command, index, total int, content string) {
    t.Helper()
    writeWS(t, ws, "bus.query.result", map[string]any{
        "requestId":   c.RequestID,
        "responseKey": c.ResponseKey,
        "content":     content,
        "index":       index,
        "total":       total,
    })
}

func queryInput() protocol.Query {
    return protocol.Query{RequestID: uuid.NewString(), Content: "查询\n中文"}
}

func TestRealtimeFlow(t *testing.T) {
    t.Run("cross-instance-broadcast", func(t *testing.T) {
        p := newPair(t, nil)
        a := dial(t, p.a, BroadcastSocketPath)
        b := dial(t, p.b, BroadcastSocketPath)
        response := post(t, p.a, BroadcastPath, protocol.Broadcast{MessageBody: "跨实例\n广播 😀"})
        if response.StatusCode != 200 {
            t.Fatal(response.StatusCode)
        }
        if response.Header.Get("Cache-Control") != "no-store" {
            t.Fatal(response.Header)
        }

        var receipt map[string]string
        _ = json.NewDecoder(response.Body).Decode(&receipt)
        _ = response.Body.Close()
        for _, ws := range []*websocket.Conn{a, b} {
            message := readWS(t, ws)
            var data map[string]string
            _ = json.Unmarshal(message.Payload, &data)
            if message.Type != "bus.broadcast.message" || data["messageId"] != receipt["messageId"] || data["messageBody"] != "跨实例\n广播 😀" || data["topic"] != protocol.BroadcastTopic {
                t.Fatal(message, string(message.Payload))
            }

            _ = ws.CloseNow()
        }

        clean(t, p)
    })
    t.Run("standard-websocket-and-invalid", func(t *testing.T) {
        p := newPair(t, nil)
        ws := dial(t, p.a, BroadcastSocketPath)
        writeWS(t, ws, "ping", map[string]any{"timestamp": 123.5, "unknown": "剥离"})
        message := readWS(t, ws)
        if message.Type != "pong" || string(message.Payload) != `{"timestamp":123.5}` {
            t.Fatal(message)
        }
        writeWS(t, ws, "echo", map[string]string{"message": "原样返回", "extra": "剥离"})
        message = readWS(t, ws)
        if message.Type != "echo" || string(message.Payload) != `{"message":"原样返回"}` {
            t.Fatal(message)
        }

        for _, raw := range []string{
            `{"type":"ping","payload":null}`,
            `{"type":"echo","payload":{"message":""}}`,
            `{"type":"unknown"}`,
            `[]`,
            `bad`,
        } {
            if err := ws.Write(context.Background(), websocket.MessageText, []byte(raw)); err != nil {
                t.Fatal(err)
            }
            if readWS(t, ws).Type != "error" {
                t.Fatal("无效消息通过")
            }
        }

        _ = ws.CloseNow()
        clean(t, p)
    })
    t.Run("socket-quota-and-message-size", func(t *testing.T) {
        p := newPair(t, func(c *Config) { c.MaxSockets = 1 })
        ws := dial(t, p.a, BroadcastSocketPath)
        ctx, cancel := context.WithTimeout(context.Background(), time.Second)
        second, response, err := websocket.Dial(ctx, strings.Replace(p.a, "http://", "ws://", 1)+BroadcastSocketPath, nil)
        cancel()
        if second != nil {
            _ = second.CloseNow()
        }
        if err == nil || response == nil || response.StatusCode != 429 {
            t.Fatal(response, err)
        }
        if err = ws.Write(context.Background(), websocket.MessageBinary, []byte(`{"type":"ping"}`)); err != nil {
            t.Fatal(err)
        }
        if readWS(t, ws).Type != "error" {
            t.Fatal("二进制消息通过")
        }

        ctx, cancel = context.WithTimeout(context.Background(), time.Second)
        defer cancel()
        _ = ws.Write(ctx, websocket.MessageText, []byte(strings.Repeat("x", 8193)))
        if _, _, err = ws.Read(ctx); err == nil {
            t.Fatal("超大消息通过")
        }

        _ = ws.CloseNow()
        clean(t, p)
    })
    t.Run("device-receipt-strict-fields", func(t *testing.T) {
        p := newPair(t, nil)
        ws := dial(t, p.b, QuerySocketPath)
        response := post(t, p.a, QueryPath, queryInput())
        c := command(t, ws)
        payload := map[string]any{
            "requestId":   c.RequestID,
            "responseKey": c.ResponseKey,
            "index":       1,
            "total":       1,
            "content":     "ok",
            "type":        "bus.query.result",
        }
        writeWS(t, ws, "bus.query.result", payload)
        if readWS(t, ws).Type != "error" {
            t.Fatal("payload 内 type 额外字段通过")
        }
        delete(payload, "type")
        payload["message"] = nil
        writeWS(t, ws, "bus.query.result", payload)
        if readWS(t, ws).Type != "error" {
            t.Fatal("null 额外字段通过")
        }
        result(t, ws, c, 1, 1, "合法回执")
        events := readEvents(t, response)
        if len(events) != 3 || events[1].kind != "result" {
            t.Fatal(events)
        }

        _ = ws.CloseNow()
        clean(t, p)
    })

    t.Run("origin-whitelist", func(t *testing.T) {
        p := newPair(t, func(c *Config) { c.Origins = []string{"http://localhost:5173"} })
        for _, item := range []struct {
            origin string
            status int
        }{
            {"http://evil.example", 403},
            {"http://localhost:5173.evil.example", 403},
            {"http://localhost:5173", 101},
        } {
            ctx, cancel := context.WithTimeout(context.Background(), time.Second)
            ws, response, err := websocket.Dial(ctx, strings.Replace(p.a, "http://", "ws://", 1)+BroadcastSocketPath, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {item.origin}}})
            cancel()
            if response == nil || response.StatusCode != item.status {
                t.Fatal(response, err)
            }
            if ws != nil {
                _ = ws.CloseNow()
            }
        }

        clean(t, p)
    })
    t.Run("cross-instance-query-dedup-and-validation", func(t *testing.T) {
        p := newPair(t, nil)
        ws := dial(t, p.b, QuerySocketPath)
        response := post(t, p.a, QueryPath, queryInput())
        c := command(t, ws)
        // 错请求 ID、越界 index 和不同 total 都由结果消费者过滤。
        wrong := c
        wrong.RequestID = uuid.NewString()
        result(t, ws, wrong, 1, 2, "错误关联")
        result(t, ws, c, 3, 2, "越界")
        result(t, ws, c, 1, 2, "第一条\n换行")
        result(t, ws, c, 1, 2, "重复")
        result(t, ws, c, 2, 3, "不同总数")
        result(t, ws, c, 2, 2, "第二条")
        events := readEvents(t, response)
        if len(events) != 4 || events[0].kind != "ready" || events[1].kind != "result" || events[2].kind != "result" || events[3].kind != "done" {
            t.Fatal(events)
        }

        var value protocol.Receipt
        _ = json.Unmarshal(events[1].data, &value)
        if *value.Content != "第一条\n换行" {
            t.Fatal(value)
        }

        _ = ws.CloseNow()
        clean(t, p)
    })
    t.Run("same-request-id-responsekey-isolation", func(t *testing.T) {
        p := newPair(t, nil)
        ws := dial(t, p.b, QuerySocketPath)
        input := queryInput()
        first := post(t, p.a, QueryPath, input)
        a := command(t, ws)
        second := post(t, p.a, QueryPath, input)
        b := command(t, ws)
        if a.ResponseKey == b.ResponseKey {
            t.Fatal("responseKey 重复")
        }
        result(t, ws, b, 1, 1, "B")
        result(t, ws, a, 1, 1, "A")
        for _, item := range []struct {
            response *http.Response
            want     string
        }{{first, "A"}, {second, "B"}} {
            events := readEvents(t, item.response)
            if len(events) != 3 || events[1].kind != "result" {
                t.Fatal(events)
            }

            var value protocol.Receipt
            _ = json.Unmarshal(events[1].data, &value)
            if *value.Content != item.want {
                t.Fatal(value)
            }
        }

        _ = ws.CloseNow()
        clean(t, p)
    })
    t.Run("offline-ignores-redis-subscriber-count", func(t *testing.T) {
        p := newPair(t, nil)
        sub, err := p.two.Bus.Subscribe(context.Background(), protocol.QueryTopic)
        if err != nil {
            t.Fatal(err)
        }

        response := post(t, p.a, QueryPath, queryInput())
        expectError(t, readEvents(t, response), "DEVICE_OFFLINE")
        sub.Close()
        clean(t, p)
    })
    t.Run("device-error", func(t *testing.T) {
        p := newPair(t, nil)
        ws := dial(t, p.b, QuerySocketPath)
        response := post(t, p.a, QueryPath, queryInput())
        c := command(t, ws)
        writeWS(t, ws, "bus.query.error", map[string]string{
            "requestId":   c.RequestID,
            "responseKey": c.ResponseKey,
            "message":     "业务失败",
        })
        expectError(t, readEvents(t, response), "DEVICE_ERROR")
        _ = ws.CloseNow()
        clean(t, p)
    })
    t.Run("query-timeout", func(t *testing.T) {
        p := newPair(t, nil)
        ws := dial(t, p.b, QuerySocketPath)
        response := post(t, p.a, QueryPath, queryInput())
        _ = command(t, ws)
        expectError(t, readEvents(t, response), "QUERY_TIMEOUT")
        _ = ws.CloseNow()
        clean(t, p)
    })
    t.Run("device-disconnected", func(t *testing.T) {
        p := newPair(t, nil)
        ws := dial(t, p.b, QuerySocketPath)
        response := post(t, p.a, QueryPath, queryInput())
        _ = command(t, ws)
        _ = ws.CloseNow()
        expectError(t, readEvents(t, response), "DEVICE_DISCONNECTED")
        clean(t, p)
    })
    t.Run("client-cancel", func(t *testing.T) {
        p := newPair(t, nil)
        ws := dial(t, p.b, QuerySocketPath)
        ctx, cancel := context.WithCancel(context.Background())
        raw, _ := json.Marshal(queryInput())
        request, _ := http.NewRequestWithContext(ctx, "POST", p.a+QueryPath, bytes.NewReader(raw))
        request.Header.Set("Content-Type", "application/json")
        response, err := http.DefaultClient.Do(request)
        if err != nil {
            t.Fatal(err)
        }

        _ = command(t, ws)
        cancel()
        _ = response.Body.Close()
        _ = ws.CloseNow()
        clean(t, p)
    })
    t.Run("redis-pubsub-failure", func(t *testing.T) {
        p := newPair(t, nil)
        ws := dial(t, p.b, QuerySocketPath)
        response := post(t, p.a, QueryPath, queryInput())
        _ = command(t, ws)
        if err := p.one.Bus.Client.Do(context.Background(), "CLIENT", "KILL", "TYPE", "pubsub").Err(); err != nil {
            t.Fatal(err)
        }
        expectError(t, readEvents(t, response), "BUS_UNAVAILABLE")
        _ = ws.CloseNow()
        clean(t, p)
    })
    t.Run("sse-flush-heartbeat-and-deadline-reset", func(t *testing.T) {
        p := newPair(t, func(c *Config) {
            c.WriteTimeout = 20 * time.Millisecond
            c.Heartbeat = 55 * time.Millisecond
        })
        ws := dial(t, p.b, QuerySocketPath)
        response := post(t, p.a, QueryPath, queryInput())
        c := command(t, ws)
        if response.Header.Get("Content-Type") != "text/event-stream; charset=utf-8" || response.Header.Get("X-Accel-Buffering") != "no" {
            t.Fatal(response.Header)
        }

        scan := bufio.NewScanner(response.Body)
        heartbeat := false
        for scan.Scan() {
            if scan.Text() == ": ping" {
                heartbeat = true
                break
            }
        }

        if !heartbeat {
            t.Fatal("心跳未逐条刷新", scan.Err())
        }
        result(t, ws, c, 1, 1, "写期限清除后继续")
        found := false
        for scan.Scan() {
            if scan.Text() == "event: result" {
                found = true
            }
        }

        if scan.Err() != nil || !found {
            t.Fatal("旧写期限残留", scan.Err())
        }

        _ = ws.CloseNow()
        clean(t, p)
    })
    t.Run("query-quota", func(t *testing.T) {
        p := newPair(t, func(c *Config) { c.MaxQueries = 1 })
        ws := dial(t, p.b, QuerySocketPath)
        first := post(t, p.a, QueryPath, queryInput())
        _ = command(t, ws)
        second := post(t, p.a, QueryPath, queryInput())
        if second.StatusCode != 429 {
            t.Fatal(second.StatusCode)
        }

        _ = first.Body.Close()
        _ = ws.CloseNow()
        clean(t, p)
    })
    t.Run("runtime-shutdown-active-streams", func(t *testing.T) {
        p := newPair(t, nil)
        ws := dial(t, p.a, QuerySocketPath)
        broadcast := dial(t, p.a, BroadcastSocketPath)
        response := post(t, p.a, QueryPath, queryInput())
        _ = command(t, ws)
        done := make(chan struct{})
        go func() {
            p.one.Close()
            close(done)
        }()
        select {
        case <-done:
        case <-time.After(2 * time.Second):
            t.Fatal("Web 实时退出超时")
        }

        _, _ = io.ReadAll(response.Body)
        _ = response.Body.Close()
        _ = ws.CloseNow()
        _ = broadcast.CloseNow()
        p.one.Close()
        clean(t, p)
    })
    t.Run("body-and-schema-boundaries", func(t *testing.T) {
        p := newPair(t, nil)
        cases := []struct {
            raw, contentType string
            status           int
            error            string
        }{
            {
                `{"messageBody":"ok"}`,
                "text/plain",
                415,
                "请使用 JSON 格式提交消息。",
            },
            {
                strings.Repeat("x", 8193),
                "application/json",
                413,
                "请求内容过长。",
            },
            {`bad`, "application/json", 400, "消息必须是合法 JSON。"},
            {
                `{"messageBody":"ok","extra":1}`,
                "application/json",
                400,
                "消息长度需为 1 至 2000 个字符，且只能包含 messageBody 字段。",
            },
            {
                `{"messageBody":""}`,
                "application/json",
                400,
                "消息长度需为 1 至 2000 个字符，且只能包含 messageBody 字段。",
            },
        }
        for _, item := range cases {
            request, _ := http.NewRequest("POST", p.a+BroadcastPath, strings.NewReader(item.raw))
            request.Header.Set("Content-Type", item.contentType)
            response, err := http.DefaultClient.Do(request)
            if err != nil {
                t.Fatal(err)
            }

            raw, _ := io.ReadAll(response.Body)
            _ = response.Body.Close()
            var value map[string]string
            _ = json.Unmarshal(raw, &value)
            if response.StatusCode != item.status || value["error"] != item.error {
                t.Fatalf("%d %s", response.StatusCode, raw)
            }
        }

        clean(t, p)
    })
    t.Run("non-reading-websocket-bounded-cleanup", func(t *testing.T) {
        p := newPair(t, func(c *Config) {
            c.Outbox = 1
            c.WriteTimeout = 40 * time.Millisecond
        })
        ws := dial(t, p.a, BroadcastSocketPath)
        for i := 0; i < 1600 && p.one.Bus.Active() > 0; i++ {
            if _, err := p.two.Bus.Publish(context.Background(), protocol.BroadcastTopic, protocol.Broadcast{MessageBody: strings.Repeat("中", 2000)}); err != nil {
                t.Fatal(err)
            }
        }

        clean(t, p)
        _ = ws.CloseNow()
    })

    t.Run("namespace-isolation", func(t *testing.T) {
        p := newPair(t, nil)
        other := newPair(t, nil)
        ws := dial(t, p.b, BroadcastSocketPath)
        _ = post(t, other.a, BroadcastPath, protocol.Broadcast{MessageBody: "其他 namespace"}).Body.Close()
        _ = post(t, p.a, BroadcastPath, protocol.Broadcast{MessageBody: "正确 namespace"}).Body.Close()
        message := readWS(t, ws)
        if !bytes.Contains(message.Payload, []byte("正确 namespace")) {
            t.Fatal(message)
        }

        _ = ws.CloseNow()
        clean(t, p)
        clean(t, other)
    })
}

// 使用脚本启动的两个独立 OS 进程，补充进程内双 Echo 之外的拓扑验证。
func TestExternalWebProcesses(t *testing.T) {
    a, b := os.Getenv("TEST_WEB_A"), os.Getenv("TEST_WEB_B")
    if a == "" || b == "" {
        t.Skip("需要两个外部 Web 进程")
    }

    broadcast := dial(t, b, BroadcastSocketPath)
    response := post(t, a, BroadcastPath, protocol.Broadcast{MessageBody: "独立进程广播"})
    if response.StatusCode != 200 {
        t.Fatal(response.StatusCode)
    }

    _ = response.Body.Close()
    if message := readWS(t, broadcast); message.Type != "bus.broadcast.message" {
        t.Fatal(message)
    }

    device := dial(t, b, QuerySocketPath)
    response = post(t, a, QueryPath, queryInput())
    c := command(t, device)
    result(t, device, c, 1, 1, "独立进程查询")
    events := readEvents(t, response)
    if len(events) != 3 || events[1].kind != "result" {
        t.Fatal(events)
    }

    _ = device.CloseNow()
    _ = broadcast.CloseNow()
    for _, base := range []string{a, b} {
        deadline := time.Now().Add(2 * time.Second)
        for {
            response, err := externalGet(base, "/api/rest/poc/realtime/stats")
            if err != nil {
                t.Fatal(err)
            }

            var values map[string]int
            _ = json.NewDecoder(response.Body).Decode(&values)
            _ = response.Body.Close()
            if values["sessions"] == 0 && values["subscriptions"] == 0 {
                break
            }
            if time.Now().After(deadline) {
                t.Fatal(values)
            }
            time.Sleep(20 * time.Millisecond)
        }

        response, err := http.Get(base + "/api/rest/internal/health")
        if err != nil {
            t.Fatal(err)
        }

        raw, _ := io.ReadAll(response.Body)
        _ = response.Body.Close()
        if response.StatusCode != 200 || string(raw) != "ok\n" {
            t.Fatal(response.StatusCode, string(raw))
        }

        response = post(t, base, "/api/graphql/member", map[string]string{"query": "{__typename}"})
        raw, _ = io.ReadAll(response.Body)
        _ = response.Body.Close()
        if response.StatusCode != 200 || !bytes.Contains(raw, []byte(`"data"`)) {
            t.Fatal(fmt.Sprint(response.StatusCode), string(raw))
        }
    }
}

// 脚本显式传入外部 Web 会话，仅应用于脚本提供的地址。
func externalHeaders(base string) http.Header {
    headers := http.Header{}
    if token := os.Getenv("TEST_AUTH_TOKEN"); token != "" && (base == os.Getenv("TEST_WEB_A") || base == os.Getenv("TEST_WEB_B")) {
        headers.Set("Authorization", "Bearer "+token)
    }
    return headers
}

func externalGet(base, path string) (*http.Response, error) {
    request, err := http.NewRequest("GET", base+path, nil)
    if err != nil {
        return nil, err
    }

    request.Header = externalHeaders(base)
    return http.DefaultClient.Do(request)
}
