package server

import (
    "context"
    "encoding/json"
    "net/http"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/ws"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/protocol"
    "github.com/coder/websocket"
    "github.com/google/uuid"
    "github.com/labstack/echo/v5"
)

// frame 保存发送队列中的 WebSocket 消息类型及原始载荷。
type frame struct {
    kind websocket.MessageType
    raw  []byte
}

// socket 管理有界读写协程、订阅和设备在线状态，并在连接检查或上下文终止时收敛资源。
func (r *Runtime) socket(c *echo.Context, device bool) error {
    if !ws.OriginAllowed(c.Request().Header.Get("Origin"), r.config.Origins) {
        return jsonError(c, http.StatusForbidden, "WebSocket 来源未授权。")
    }

    select {
    case r.sockets <- struct{}{}:
        defer func() { <-r.sockets }()
    default:
        return jsonError(c, 429, "连接配额已满。")
    }

    parent, finish, ok := r.begin(c.Request().Context())
    if !ok {
        return jsonError(c, 503, "Web 正在退出。")
    }
    defer finish()
    ctx, cancel := context.WithCancel(parent)
    defer cancel()
    conn, err := ws.Accept(c.Response(), c.Request(), r.config.Origins, 8192)
    if err != nil {
        return nil
    }
    defer conn.CloseNow()
    stop := context.AfterFunc(ctx, func() { _ = conn.CloseNow() })
    defer stop()
    out := make(chan protocol.ServerMessage, r.config.Outbox)
    in := make(chan frame, 8)
    // 收发协程共享取消信号，任一侧退出后由清理流程等待两侧全部结束。
    writerDone := make(chan struct{})
    readerDone := make(chan struct{})
    go func() {
        defer close(writerDone)
        defer cancel()
        for {
            select {
            case <-ctx.Done():
                return
            case message := <-out:
                if auth.ValidateConnection(ctx) != nil {
                    return
                }
                raw, err := json.Marshal(message)
                if err != nil {
                    return
                }
                writeCtx, done := context.WithTimeout(ctx, r.config.WriteTimeout)
                err = conn.Write(writeCtx, websocket.MessageText, raw)
                done()
                if err != nil {
                    return
                }
            }
        }
    }()
    go func() {
        defer close(readerDone)
        defer cancel()
        for {
            kind, raw, err := conn.Read(ctx)
            if err != nil {
                return
            }

            select {
            case in <- frame{kind, raw}:
            case <-ctx.Done():
                return
            }
        }
    }()
    defer func() {
        cancel()
        _ = conn.CloseNow()
        <-writerDone
        <-readerDone
    }()
    // 发送缓冲满时取消整个连接，使慢客户端的积压限制在固定容量内。
    send := func(kind string, payload any) bool {
        select {
        case <-ctx.Done():
            return false
        case out <- protocol.Message(kind, payload, time.Now()):
            return true
        default:
            cancel()
            return false
        }
    }
    connectionID := uuid.NewString()
    endpoint := "busBroadcast"
    topic := protocol.BroadcastTopic
    if device {
        endpoint = "busQuery"
        topic = protocol.QueryTopic
    }

    sub, err := r.Bus.Subscribe(ctx, topic)
    if err != nil {
        _ = conn.Close(websocket.StatusInternalError, "Bus unavailable.")
        return nil
    }
    defer sub.Close()
    if !send("ready", map[string]string{"connectionId": connectionID, "endpoint": endpoint}) {
        return nil
    }

    if device {
        if r.Bus.PresenceRefresh(ctx, connectionID, r.config.DeviceTTL) != nil {
            return nil
        }
        defer r.Bus.PresenceRemove(context.Background(), connectionID)
        if !send("bus.query.ready", map[string]string{"message": "设备已订阅查询。"}) {
            return nil
        }
    }

    refresh := time.NewTicker(r.config.DeviceRefresh)
    defer refresh.Stop()
    for {
        select {
        case <-ctx.Done():
            return nil
        case <-sub.Done:
            return nil
        case <-refresh.C:
            if auth.ValidateConnection(ctx) != nil {
                return nil
            }
            if device && r.Bus.PresenceRefresh(ctx, connectionID, r.config.DeviceTTL) != nil {
                return nil
            }
        case message := <-sub.Messages:
            if auth.ValidateConnection(ctx) != nil {
                return nil
            }
            if device {
                command, err := protocol.ParseCommand(message.Payload)
                if err != nil {
                    continue
                }
                if !send("bus.query.execute", map[string]string{
                    "requestId":   command.RequestID,
                    "responseKey": command.ResponseKey,
                    "content":     command.Content,
                }) {
                    return nil
                }
            } else {
                broadcast, err := protocol.ParseBroadcast(message.Payload)
                if err != nil {
                    continue
                }
                if !send("bus.broadcast.message", map[string]string{
                    "topic":       protocol.BroadcastTopic,
                    "messageId":   message.ID,
                    "messageBody": broadcast.MessageBody,
                }) {
                    return nil
                }
            }
        case packet := <-in:
            if auth.ValidateConnection(ctx) != nil {
                return nil
            }
            var input protocol.ClientMessage
            invalid := func() { send("error", map[string]string{"message": "Invalid WebSocket message."}) }
            if packet.kind != websocket.MessageText || jsonObject(packet.raw, &input) != nil {
                invalid()
                continue
            }
            switch input.Type {
            case "ping":
                payload := map[string]any{}
                if len(input.Payload) != 0 {
                    var values map[string]json.RawMessage
                    if jsonObject(input.Payload, &values) != nil {
                        invalid()
                        continue
                    }
                    if value, present := values["timestamp"]; present {
                        var number float64
                        if string(value) == "null" || json.Unmarshal(value, &number) != nil {
                            invalid()
                            continue
                        }

                        payload["timestamp"] = number
                    }
                }
                send("pong", payload)
            case "echo":
                var value struct {
                    Message string `json:"message"`
                }
                if jsonObject(input.Payload, &value) != nil || !protocol.Text(value.Message, 1, 2000) {
                    invalid()
                    continue
                }
                send("echo", value)
            case "bus.query.result", "bus.query.error":
                if !device {
                    invalid()
                    continue
                }
                var fields map[string]json.RawMessage
                if jsonObject(input.Payload, &fields) != nil {
                    invalid()
                    continue
                }
                if _, present := fields["type"]; present {
                    invalid()
                    continue
                }
                fields["type"], _ = json.Marshal(input.Type)
                raw, _ := json.Marshal(fields)
                receipt, err := protocol.ParseReceipt(raw)
                if err != nil {
                    invalid()
                    continue
                }
                if _, err = r.Bus.Publish(ctx, protocol.ResultTopic(receipt.ResponseKey), receipt); err != nil {
                    send("error", map[string]string{"message": "设备回执发布失败。"})
                }
            default:
                invalid()
            }
        }
    }
}
