package observability

import (
    "context"
    "encoding/json"
    "errors"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httpx"
    "github.com/getsentry/sentry-go"
    "github.com/hibiken/asynq"
    "github.com/labstack/echo/v5"
)

type memoryTransport struct {
    events        []*sentry.Event
    fail          bool
    configureFail bool
    closed        bool
}

func (t *memoryTransport) Configure(sentry.ClientOptions) {
    if t.configureFail {
        panic("secret")
    }
}
func (t *memoryTransport) Flush(time.Duration) bool              { return true }
func (t *memoryTransport) FlushWithContext(context.Context) bool { return true }
func (t *memoryTransport) Close()                                { t.closed = true }
func (t *memoryTransport) SendEvent(event *sentry.Event) {
    if t.fail {
        panic("transport secret")
    }
    t.events = append(t.events, event)
}

func TestDisabledAndSanitizedReporting(t *testing.T) {
    disabled := New(Config{}, nil)
    disabled.Capture(context.Background(), errors.New("secret"), "web")
    if !disabled.Flush(time.Millisecond) {
        t.Fatal("默认关闭")
    }
    transport := &memoryTransport{}
    reporter := New(Config{DSN: "https://public@example.com/1", Environment: "test", Release: "test"}, transport)
    reporter.Capture(context.Background(), errors.New("DSN=password=secret"), "web")
    if len(transport.events) != 1 {
        t.Fatal("内部异常需要采集")
    }
    data, _ := json.Marshal(transport.events)
    if strings.Contains(string(data), "secret") {
        t.Fatal("事件泄露秘密")
    }
    event := sanitize(&sentry.Event{Message: "secret", ServerName: "secret", Request: &sentry.Request{URL: "https://example.com/?token=secret"}, Contexts: map[string]sentry.Context{"custom": {"password": "secret"}}, User: sentry.User{Email: "secret"}, Exception: []sentry.Exception{{Value: "secret"}}}, nil)
    data, _ = json.Marshal(event)
    if strings.Contains(string(data), "secret") {
        t.Fatal("白名单脱敏失败")
    }
    transport.fail = true
    reporter.Capture(context.Background(), errors.New("secret"), "web")
    invalid := New(Config{DSN: "secret invalid"}, nil)
    invalid.Capture(context.Background(), errors.New("secret"), "web")
    if New(Config{DSN: "https://public@example.com/1"}, &memoryTransport{configureFail: true}) != nil {
        t.Fatal("初始化故障应关闭监控")
    }
    reporter.Close(time.Millisecond)
    if !transport.closed {
        t.Fatal("传输资源需要关闭")
    }
    disabled.Close(time.Millisecond)
}

func TestHTTPMonitoringPreservesResponsesAndFiltersBusinessErrors(t *testing.T) {
    transport := &memoryTransport{}
    reporter := New(Config{DSN: "https://public@example.com/1"}, transport)
    e := httpx.New()
    reporter.RegisterHTTP(e)
    e.GET("/error", func(c *echo.Context) error { return errors.New("password=secret") })
    e.GET("/panic", func(c *echo.Context) error { panic("password=secret") })
    e.GET("/handled", func(c *echo.Context) error {
        e.HTTPErrorHandler(c, errors.New("secret"))
        return nil
    })
    e.GET("/business", func(c *echo.Context) error { return &httperr.Error{Code: "BAD_USER_INPUT", Message: "输入无效"} })
    e.GET("/status", func(c *echo.Context) error { return c.NoContent(503) })
    for _, route := range []string{"/error", "/panic", "/handled", "/business", "/status", "/missing"} {
        response := httptest.NewRecorder()
        e.ServeHTTP(response, httptest.NewRequest(http.MethodGet, route+"?token=secret", nil))
        if strings.Contains(response.Body.String(), "secret") {
            t.Fatal("公开响应泄露秘密")
        }
        if route == "/business" && response.Code != 400 {
            t.Fatal("业务响应改变")
        }
    }
    if len(transport.events) != 4 {
        t.Fatalf("需要 4 次内部异常上报，实际 %d", len(transport.events))
    }
}

func TestWorkerMonitoringPreservesRetryAndPanic(t *testing.T) {
    transport := &memoryTransport{}
    reporter := New(Config{DSN: "https://public@example.com/1"}, transport)
    failure := errors.New("secret")
    for _, err := range []error{nil, context.Canceled, failure} {
        handler := reporter.WorkerMiddleware(asynq.HandlerFunc(func(context.Context, *asynq.Task) error { return err }))
        if handler.ProcessTask(context.Background(), nil) != err {
            t.Fatal("队列错误身份改变")
        }
    }
    func() {
        defer func() {
            if recover() != "secret" {
                t.Fatal("队列 panic 契约改变")
            }
        }()
        handler := reporter.WorkerMiddleware(asynq.HandlerFunc(func(context.Context, *asynq.Task) error { panic("secret") }))
        handler.ProcessTask(context.Background(), nil)
    }()
    if len(transport.events) != 2 {
        t.Fatalf("内部异常需要采集两次，实际 %d", len(transport.events))
    }
}

func TestDefaultTransportCloseRespectsFlushTimeout(t *testing.T) {
    started := make(chan struct{}, 1)
    release := make(chan struct{})
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
        select {
        case started <- struct{}{}:
        default:
        }
        <-release
        w.WriteHeader(http.StatusOK)
    }))
    defer server.Close()
    defer close(release)
    reporter := New(Config{DSN: "http://public@" + server.Listener.Addr().String() + "/1"}, nil)
    if reporter == nil {
        t.Fatal("默认传输需要初始化")
    }
    reporter.Capture(context.Background(), errors.New("secret"), "web")
    select {
    case <-started:
    case <-time.After(2 * time.Second):
        t.Fatal("事件请求需要进入传输")
    }
    finished := make(chan struct{})
    go func() {
        reporter.Close(20 * time.Millisecond)
        close(finished)
    }()
    select {
    case <-finished:
    case <-time.After(300 * time.Millisecond):
        t.Error("关闭过程超出 flush 期限，慢请求应由传输异步收敛")
    }
}
