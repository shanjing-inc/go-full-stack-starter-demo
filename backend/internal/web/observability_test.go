package web_test

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/observability"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
    "context"
    "github.com/getsentry/sentry-go"
    "io"
    "log/slog"
    "net/http"
    "strings"
    "testing"
    "time"
)

type monitoringTransport struct{ count int }

func (t *monitoringTransport) Configure(sentry.ClientOptions)        {}
func (t *monitoringTransport) Flush(time.Duration) bool              { return true }
func (t *monitoringTransport) FlushWithContext(context.Context) bool { return true }
func (t *monitoringTransport) Close()                                {}
func (t *monitoringTransport) SendEvent(event *sentry.Event)         { t.count++ }

func TestGraphQLInternalErrorReporting(t *testing.T) {
    for _, panicGet := range []bool{false, true} {
        transport := &monitoringTransport{}
        monitoring := observability.New(observability.Config{DSN: "https://public@example.com/1"}, transport)
        api := subject.New(faultService{Shops: newMemory(), panicGet: panicGet}, subject.Config{
            Logger: monitoring.GraphQLLogger(slog.New(slog.NewTextHandler(io.Discard, nil))),
        })
        response := perform(api, http.MethodPost, subject.MemberPath, `{"query":"{getShop(where:{id:{eq:500}}){id}}"}`, nil)
        if transport.count != 1 || strings.Contains(response.Body.String(), "secret") || response.Code != 200 {
            t.Fatalf("异常采集或响应契约失败：%d %s", transport.count, response.Body.String())
        }
    }
    transport := &monitoringTransport{}
    monitoring := observability.New(observability.Config{DSN: "https://public@example.com/1"}, transport)
    api := subject.New(faultService{Shops: newMemory()}, subject.Config{Logger: monitoring.GraphQLLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))})
    perform(api, http.MethodPost, subject.MemberPath, `{"query":"{getShop(where:{id:{eq:400}}){id}}"}`, nil)
    perform(api, http.MethodPost, subject.MemberPath, `{"query":"{missingField}"}`, nil)
    if transport.count != 0 {
        t.Fatal("业务与校验错误应保持静默")
    }
}
