// Package observability 为应用提供默认关闭、白名单脱敏的错误监控。
package observability

import (
    "context"
    "errors"
    "log/slog"
    "path/filepath"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/requestmeta"
    "github.com/getsentry/sentry-go"
    "github.com/google/uuid"
    "github.com/hibiken/asynq"
    "github.com/labstack/echo/v5"
)

// Config 的空 DSN 关闭监控；Environment 与 Release 只承载公开部署标识。
type Config struct{ DSN, Environment, Release string }

// Reporter 使用进程独立 Client，避免全局 Hub 与请求间状态串联。
type Reporter struct{ client *sentry.Client }

// New 对无效监控配置安全降级，transport 用于离线测试或自定义传输。
func New(config Config, transport sentry.Transport) (reporter *Reporter) {
    defer func() {
        if recover() != nil {
            reporter = nil
        }
    }()
    if config.DSN == "" {
        return nil
    }
    // 显式异步传输使 Close 即时释放；SDK 默认 telemetry 关闭另有等待期限。
    if transport == nil {
        transport = sentry.NewHTTPTransport()
    }
    client, err := sentry.NewClient(sentry.ClientOptions{
        Dsn: config.DSN, Environment: config.Environment, Release: config.Release,
        Transport: transport, SendDefaultPII: false, EnableTracing: false,
        BeforeSend:   sanitize,
        Integrations: func([]sentry.Integration) []sentry.Integration { return nil },
    })
    if err != nil {
        return nil
    }
    return &Reporter{client: client}
}

// Capture 过滤可预期失败，内部异常使用固定消息与当前调用栈。
func (r *Reporter) Capture(ctx context.Context, err error, subsystem string) {
    if r == nil || err == nil || errors.Is(err, context.Canceled) {
        return
    }
    var business *httperr.Error
    var status echo.HTTPStatusCoder
    if errors.As(err, &business) && httperr.AllowedCode(business.Code) {
        return
    }
    if errors.As(err, &status) && status.StatusCode() < 500 {
        return
    }
    defer func() { _ = recover() }()
    event := sentry.NewEvent()
    event.Level = sentry.LevelError
    event.Exception = []sentry.Exception{{Type: "InternalError", Value: "服务端内部异常", Stacktrace: sentry.NewStacktrace()}}
    event.Tags = map[string]string{"subsystem": subsystem}
    meta, _ := requestmeta.RequestFrom(ctx)
    if _, err := uuid.Parse(meta.RequestID); err == nil {
        event.Tags["request_id"] = meta.RequestID
    }
    if meta.Endpoint == "/api/graphql/admin" || meta.Endpoint == "/api/graphql/member" {
        event.Tags["endpoint"] = meta.Endpoint
    }
    r.client.CaptureEvent(event, nil, nil)
}

func sanitize(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
    clean := &sentry.Event{EventID: event.EventID, Timestamp: event.Timestamp, Level: event.Level, Platform: event.Platform, Release: event.Release, Environment: event.Environment}
    clean.Tags = map[string]string{}
    if value := event.Tags["subsystem"]; value == "web" || value == "worker" || value == "graphql" {
        clean.Tags["subsystem"] = value
    }
    if value := event.Tags["request_id"]; value != "" {
        if _, err := uuid.Parse(value); err == nil {
            clean.Tags["request_id"] = value
        }
    }
    if value := event.Tags["endpoint"]; value == "/api/graphql/admin" || value == "/api/graphql/member" {
        clean.Tags["endpoint"] = value
    }
    for _, exception := range event.Exception {
        safe := sentry.Exception{Type: "InternalError", Value: "服务端内部异常"}
        if exception.Stacktrace != nil {
            safe.Stacktrace = &sentry.Stacktrace{}
            for _, frame := range exception.Stacktrace.Frames {
                safe.Stacktrace.Frames = append(safe.Stacktrace.Frames, sentry.Frame{
                    Function: frame.Function, Module: frame.Module, Filename: filepath.Base(frame.Filename),
                    Lineno: frame.Lineno, Colno: frame.Colno, InApp: frame.InApp,
                })
            }
        }
        clean.Exception = append(clean.Exception, safe)
    }
    return clean
}

// Flush 在进程退出期限内等待已排队事件，关闭时调用。
func (r *Reporter) Flush(timeout time.Duration) (ok bool) {
    if r == nil {
        return true
    }
    defer func() {
        if recover() != nil {
            ok = false
        }
    }()
    return r.client.Flush(timeout)
}

// Close 在退出期限内发送事件并释放传输资源。
func (r *Reporter) Close(timeout time.Duration) {
    if r == nil {
        return
    }
    r.Flush(timeout)
    defer func() { _ = recover() }()
    r.client.Close()
}

// RegisterHTTP 沿用 Echo 现有错误响应和 recover，同时覆盖直接返回的 5xx。
func (r *Reporter) RegisterHTTP(e *echo.Echo) {
    if r == nil {
        return
    }
    const handledKey = "observability.http-error-handled"
    original := e.HTTPErrorHandler
    e.HTTPErrorHandler = func(c *echo.Context, err error) {
        if c.Get(handledKey) != true {
            c.Set(handledKey, true)
            r.Capture(c.Request().Context(), err, "web")
        }
        original(c, err)
    }
    e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
        return func(c *echo.Context) error {
            err := next(c)
            if response, unwrapErr := echo.UnwrapResponse(c.Response()); err == nil && c.Get(handledKey) != true && unwrapErr == nil && response.Status >= 500 {
                r.Capture(c.Request().Context(), errors.New("HTTP 内部异常"), "web")
            }
            return err
        }
    })
}

// WorkerMiddleware 保持队列的重试与 panic 恢复契约，任务内容留在队列边界内。
func (r *Reporter) WorkerMiddleware(next asynq.Handler) asynq.Handler {
    return asynq.HandlerFunc(func(ctx context.Context, task *asynq.Task) (err error) {
        defer func() {
            if value := recover(); value != nil {
                r.Capture(ctx, errors.New("Worker 执行发生异常"), "worker")
                panic(value)
            }
        }()
        err = next.ProcessTask(ctx, task)
        r.Capture(ctx, err, "worker")
        return err
    })
}

// GraphQLLogger 订阅公共传输层已过滤的内部错误日志，业务与解析错误沿用既有策略。
func (r *Reporter) GraphQLLogger(base *slog.Logger) *slog.Logger {
    if r == nil {
        return base
    }
    return slog.New(graphQLHandler{Handler: base.Handler(), reporter: r})
}

type graphQLHandler struct {
    slog.Handler
    reporter *Reporter
}

func (h graphQLHandler) Handle(ctx context.Context, record slog.Record) error {
    if record.Level >= slog.LevelError && record.Message == "GraphQL 操作异常" {
        h.reporter.Capture(ctx, errors.New("GraphQL 内部异常"), "graphql")
    }
    return h.Handler.Handle(ctx, record)
}
func (h graphQLHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
    return graphQLHandler{Handler: h.Handler.WithAttrs(attrs), reporter: h.reporter}
}
func (h graphQLHandler) WithGroup(name string) slog.Handler {
    return graphQLHandler{Handler: h.Handler.WithGroup(name), reporter: h.reporter}
}
