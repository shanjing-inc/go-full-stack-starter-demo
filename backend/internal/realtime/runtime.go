// Package server 将实时路由与 REST、双 GraphQL 组装到同一个 Echo Web。
package server

import (
    "context"
    "encoding/json"
    "errors"
    "io"
    "mime"
    "net/http"
    "sync"
    "time"
    "unicode/utf8"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/bus"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/sse"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/protocol"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
    web "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
    "github.com/google/uuid"
    "github.com/labstack/echo/v5"
)

// QueryPath 定义 SSE 查询的 HTTP 入口。
const QueryPath = "/api/rest/bus/query"

// BroadcastPath 定义 Bus 广播的 HTTP 入口。
const BroadcastPath = "/api/rest/bus/broadcast"

// QuerySocketPath 定义设备查询 WebSocket 入口。
const QuerySocketPath = "/api/websocket/bus-query"

// BroadcastSocketPath 定义广播 WebSocket 入口。
const BroadcastSocketPath = "/api/websocket/bus-broadcast"

// Config 配置实时来源、期限、设备在线窗口及查询、连接和发送缓冲配额。
type Config struct {
    Origins                                                         []string
    QueryTimeout, Heartbeat, WriteTimeout, DeviceTTL, DeviceRefresh time.Duration
    MaxQueries, MaxSockets, Outbox                                  int
}

// Defaults 返回实时演示的有界默认配额与时间参数。
func Defaults() Config {
    return Config{
        QueryTimeout:  5 * time.Second,
        Heartbeat:     500 * time.Millisecond,
        WriteTimeout:  time.Second,
        DeviceTTL:     2 * time.Second,
        DeviceRefresh: 500 * time.Millisecond,
        MaxQueries:    64,
        MaxSockets:    64,
        Outbox:        8,
    }
}

// Runtime 管理 Bus、会话取消函数和配额槽，关闭时等待全部已登记会话结束。
type Runtime struct {
    Bus      *bus.Redis
    config   Config
    mu       sync.Mutex
    closed   bool
    sessions map[string]context.CancelFunc
    wg       sync.WaitGroup
    queries  chan struct{}
    sockets  chan struct{}
}

// New 使用内存店铺装配演示 Web，并注册实时路由。
func New(b *bus.Redis, c Config) (*echo.Echo, *Runtime, error) {
    return Register(web.New(service.NewMemory(nil), web.Config{AllowedOrigins: c.Origins, Introspection: true}), b, c)
}

// Register 校验实时参数并向现有 Echo 注册查询、广播和 WebSocket 入口。
func Register(e *echo.Echo, b *bus.Redis, c Config) (*echo.Echo, *Runtime, error) {
    if c.QueryTimeout <= 0 || c.Heartbeat <= 0 || c.WriteTimeout <= 0 || c.DeviceTTL <= c.DeviceRefresh || c.DeviceRefresh <= 0 || c.MaxQueries < 1 || c.MaxSockets < 1 || c.Outbox < 1 {
        return nil, nil, errors.New("实时运行参数无效")
    }

    r := &Runtime{
        Bus:      b,
        config:   c,
        sessions: make(map[string]context.CancelFunc),
        queries:  make(chan struct{}, c.MaxQueries),
        sockets:  make(chan struct{}, c.MaxSockets),
    }
    e.POST(QueryPath, r.query)
    e.POST(BroadcastPath, r.broadcast)
    e.GET(QuerySocketPath, func(c *echo.Context) error { return r.socket(c, true) })
    e.GET(BroadcastSocketPath, func(c *echo.Context) error { return r.socket(c, false) })
    // 本地开发诊断端点；生产入口由配置隔离整个开发样例。
    e.GET("/api/rest/poc/realtime/stats", func(c *echo.Context) error {
        r.mu.Lock()
        n := len(r.sessions)
        r.mu.Unlock()
        return c.JSON(200, map[string]any{
            "sessions":      n,
            "subscriptions": b.Active(),
            "queries":       len(r.queries),
            "sockets":       len(r.sockets),
        })
    })
    return e, r, nil
}

// begin 原子登记可取消会话，关闭中的实例拒绝登记；清理函数可重复调用。
func (r *Runtime) begin(parent context.Context) (context.Context, func(), bool) {
    r.mu.Lock()
    defer r.mu.Unlock()
    if r.closed {
        return nil, nil, false
    }

    ctx, cancel := context.WithCancel(parent)
    id := uuid.NewString()
    r.sessions[id] = cancel
    r.wg.Add(1)
    var once sync.Once
    return ctx, func() {
        once.Do(func() {
            cancel()
            r.mu.Lock()
            delete(r.sessions, id)
            r.mu.Unlock()
            r.wg.Done()
        })
    }, true
}

// Close 标记实例关闭、取消全部会话并等待对应处理退出。
func (r *Runtime) Close() {
    r.mu.Lock()
    r.closed = true
    for _, cancel := range r.sessions {
        cancel()
    }

    r.mu.Unlock()
    r.wg.Wait()
}

func jsonError(c *echo.Context, status int, message string) error {
    return c.JSON(status, map[string]string{"error": message})
}

// readBody 校验 JSON 媒体类型并限读 8 KiB，输入错误在当前 HTTP 响应中完成。
func readBody(c *echo.Context) ([]byte, error) {
    media, _, err := mime.ParseMediaType(c.Request().Header.Get("Content-Type"))
    if err != nil || media != "application/json" {
        return nil, jsonError(c, 415, "请使用 JSON 格式提交消息。")
    }

    raw, err := io.ReadAll(http.MaxBytesReader(c.Response(), c.Request().Body, 8192))
    if err != nil {
        var large *http.MaxBytesError
        if errors.As(err, &large) {
            return nil, jsonError(c, 413, "请求内容过长。")
        }
        return nil, jsonError(c, 400, "读取请求内容失败。")
    }
    return raw, nil
}

func committed(c *echo.Context) bool {
    response, err := echo.UnwrapResponse(c.Response())
    return err == nil && response.Committed
}

// broadcast 校验广播内容并在已登记生命周期内发布，返回消息标识。
func (r *Runtime) broadcast(c *echo.Context) error {
    c.Response().Header().Set("Cache-Control", "no-store")
    raw, err := readBody(c)
    if err != nil || committed(c) {
        return err
    }
    if !json.Valid(raw) {
        return jsonError(c, 400, "消息必须是合法 JSON。")
    }

    input, err := protocol.ParseBroadcast(raw)
    if err != nil {
        return jsonError(c, 400, err.Error())
    }

    ctx, finish, ok := r.begin(c.Request().Context())
    if !ok {
        return jsonError(c, 503, "Web 正在退出。")
    }
    defer finish()
    id, err := r.Bus.Publish(ctx, protocol.BroadcastTopic, input)
    if err != nil {
        return jsonError(c, 503, "Bus 发布失败，请检查后端连接状态。")
    }
    return c.JSON(200, map[string]string{"messageId": id})
}

// query 在并发配额内执行设备查询，并通过 SSE 返回匹配回执和终止结果。
func (r *Runtime) query(c *echo.Context) error {
    raw, err := readBody(c)
    if err != nil || committed(c) {
        return err
    }

    q, err := protocol.ParseQuery(raw)
    if err != nil {
        return jsonError(c, 400, "查询参数无效。")
    }

    select {
    case r.queries <- struct{}{}:
        defer func() { <-r.queries }()
    default:
        return jsonError(c, 429, "查询并发配额已满。")
    }

    parent, finish, ok := r.begin(c.Request().Context())
    if !ok {
        return jsonError(c, 503, "Web 正在退出。")
    }
    defer finish()
    ctx, cancel := context.WithTimeout(parent, r.config.QueryTimeout)
    defer cancel()
    // 每次查询使用独立回执主题，并在发布命令前完成订阅握手，覆盖即时响应。
    responseKey := uuid.NewString()
    sub, err := r.Bus.Subscribe(ctx, protocol.ResultTopic(responseKey))
    if err != nil {
        return jsonError(c, 503, "Bus 暂时不可用。")
    }
    defer sub.Close()
    // 提交 SSE 响应后，后续业务失败通过 error 与 done 事件结束当前流。
    writer, err := stream.New(c.Response(), r.config.WriteTimeout)
    if err != nil {
        return err
    }
    if err = writer.Event("ready", map[string]string{"requestId": q.RequestID, "responseKey": responseKey}); err != nil {
        return nil
    }

    fail := func(code, message string) {
        _ = writer.Event("error", map[string]string{"code": code, "message": message})
        _ = writer.Event("done", map[string]string{"reason": code})
    }
    busFailure := func(fallback string) {
        code, message := queryFailure(ctx, parent, fallback)
        if code != "" {
            fail(code, message)
        }
    }
    count, err := r.Bus.PresenceCount(ctx)
    if err != nil {
        busFailure("Bus 暂时不可用。")
        return nil
    }
    if count == 0 {
        fail("DEVICE_OFFLINE", "设备当前离线。")
        return nil
    }

    command := protocol.Command{
        Type:        "bus.query.execute",
        RequestID:   q.RequestID,
        ResponseKey: responseKey,
        Content:     q.Content,
    }
    if _, err = r.Bus.Publish(ctx, protocol.QueryTopic, command); err != nil {
        busFailure("Bus 暂时不可用。")
        return nil
    }

    heartbeat := time.NewTicker(r.config.Heartbeat)
    defer heartbeat.Stop()
    // 按结果序号去重，并保持首次有效回执的 total，收齐后发送完成事件。
    seen := map[int]bool{}
    total := 0
    for {
        select {
        case <-parent.Done():
            return nil
        case <-ctx.Done():
            if parent.Err() == nil {
                fail("QUERY_TIMEOUT", "设备查询超时。")
            }
            return nil
        case <-sub.Done:
            busFailure("Bus 订阅已中断。")
            return nil
        case message := <-sub.Messages:
            receipt, err := protocol.ParseReceipt(message.Payload)
            if err != nil || receipt.RequestID != q.RequestID || receipt.ResponseKey != responseKey {
                continue
            }
            if receipt.Type == "bus.query.error" {
                fail("DEVICE_ERROR", *receipt.Message)
                return nil
            }
            if *receipt.Index > *receipt.Total || (total != 0 && total != *receipt.Total) || seen[*receipt.Index] {
                continue
            }
            total = *receipt.Total
            seen[*receipt.Index] = true
            if writer.Event("result", receipt) != nil {
                return nil
            }
            if len(seen) == total {
                _ = writer.Event("done", map[string]string{"reason": "completed"})
                return nil
            }
        case <-heartbeat.C:
            count, err := r.Bus.PresenceCount(ctx)
            if err != nil {
                busFailure("Bus 暂时不可用。")
                return nil
            }
            if count == 0 {
                fail("DEVICE_DISCONNECTED", "设备连接已断开。")
                return nil
            }
            if writer.Heartbeat() != nil {
                return nil
            }
        }
    }
}

// jsonObject 兼容标准 WS Schema 的未知字段剥离行为，业务回执保持 strict 校验。
func jsonObject(raw json.RawMessage, target any) error {
    if !utf8.Valid(raw) || len(raw) == 0 || string(raw) == "null" {
        return errors.New("消息对象无效")
    }

    var object map[string]json.RawMessage
    if err := json.Unmarshal(raw, &object); err != nil || object == nil {
        return errors.New("消息对象无效")
    }
    return json.Unmarshal(raw, target)
}

// Redis 操作与查询截止可能同时完成；父请求取消优先，随后判定查询超时。
func queryFailure(query, parent context.Context, fallback string) (string, string) {
    if parent.Err() != nil {
        return "", ""
    }
    if errors.Is(query.Err(), context.DeadlineExceeded) {
        return "QUERY_TIMEOUT", "设备查询超时。"
    }
    return "BUS_UNAVAILABLE", fallback
}
