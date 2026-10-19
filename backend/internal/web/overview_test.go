package web_test

import (
    "context"
    "errors"
    "net/http"
    "strings"
    "testing"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
)

type overviewShops struct {
    service.Shops
    count int64
    err   error
    calls int
}

func (s *overviewShops) Count(ctx context.Context) (int64, error) {
    s.calls++
    if err := ctx.Err(); err != nil {
        return 0, err
    }
    return s.count, s.err
}

func TestDashboardOverview(t *testing.T) {
    for _, count := range []int64{0, 42} {
        shops := &overviewShops{Shops: newMemory(), count: count}
        api := subject.New(shops, subject.Config{})
        got := perform(api, http.MethodPost, subject.AdminPath, `{"query":"{getDashboardOverview{shops backend mode}}"}`, nil)
        body := decoded(t, got.Body.Bytes()).(map[string]any)
        if got.Code != 200 || body["errors"] != nil || body["data"] == nil {
            t.Fatal(got.Code, body)
        }
        overview := body["data"].(map[string]any)["getDashboardOverview"].(map[string]any)
        if overview["shops"] != float64(count) || overview["backend"] != "Go / Echo" || overview["mode"] != "development" || shops.calls != 1 {
            t.Fatal(overview, shops.calls)
        }
        member := perform(api, http.MethodPost, subject.MemberPath, `{"query":"{getDashboardOverview{shops}}"}`, nil)
        if !strings.Contains(member.Body.String(), `Cannot query field`) {
            t.Fatal("Member Schema 隔离失效", member.Body.String())
        }
    }
}

func TestDashboardOverviewStorageError(t *testing.T) {
    shops := &overviewShops{Shops: newMemory(), err: errors.New("secret-dsn-password")}
    api := subject.New(shops, subject.Config{})
    got := perform(api, http.MethodPost, subject.AdminPath, `{"query":"{getDashboardOverview{shops}}"}`, nil)
    body := decoded(t, got.Body.Bytes()).(map[string]any)
    if body["errors"] == nil || strings.Contains(got.Body.String(), "secret-dsn-password") || shops.calls != 1 {
        t.Fatal(got.Code, got.Body.String(), shops.calls)
    }
}
