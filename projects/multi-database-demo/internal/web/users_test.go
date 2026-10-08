package server_test

// 本文件覆盖已认证用户查询，以及依赖缺失时的受控错误。

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
    "context"
    "encoding/json"
    "net/http"
    "path/filepath"
    "strings"
    "testing"
    "time"
)

func TestAdminUserQueriesAuthenticated(t *testing.T) {
    db, err := database.Open(context.Background(), "sqlite", filepath.Join(t.TempDir(), "users.sqlite"))
    if err != nil {
        t.Fatal(err)
    }

    sql, _ := db.DB()
    t.Cleanup(func() { _ = sql.Close() })
    if err := db.AutoMigrate(auth.Models()...); err != nil {
        t.Fatal(err)
    }

    var events []auth.AuditEvent
    roles := []string{"owner", "admin", "member", "user", "member,admin", "reader"}
    fixed := time.Date(2026, 10, 4, 1, 2, 3, 987000000, time.UTC)
    for i, role := range roles {
        user := auth.User{
            ID:        i + 1,
            Name:      role,
            Email:     role + "@example.test",
            Role:      &role,
            CreatedAt: fixed,
            UpdatedAt: fixed,
        }
        if err := db.Create(&user).Error; err != nil {
            t.Fatal(err)
        }

        session := auth.Session{
            UserID:    user.ID,
            Token:     role + "-token",
            ExpiresAt: time.Now().Add(time.Hour),
        }
        if err := db.Create(&session).Error; err != nil {
            t.Fatal(err)
        }
    }

    policies := auth.DefaultRolePermissions()
    policies["reader"] = []auth.Permission{{Resource: "dashboard", Action: "access:admin"}, {Resource: "user", Action: "list"}}
    authentication, err := auth.New(db, auth.Config{
        Secret:      "test-secret-with-at-least-32-bytes",
        Permissions: policies,
        AdminPaths:  []string{subject.AdminPath},
        Audit:       func(_ context.Context, event auth.AuditEvent) { events = append(events, event) },
    })
    if err != nil {
        t.Fatal(err)
    }

    api := subject.New(newMemory(), subject.Config{Authentication: authentication})
    api.Use(authentication.Guard)
    performUser := func(role, query string, variables map[string]any) map[string]any {
        raw, _ := json.Marshal(map[string]any{"query": query, "variables": variables})
        headers := map[string]string{}
        if role != "" {
            headers["Authorization"] = "Bearer " + role + "-token"
        }

        got := perform(api, http.MethodPost, subject.AdminPath, string(raw), headers)
        if role == "" || role == "member" || role == "user" {
            status := 403
            if role == "" {
                status = 401
            }
            if got.Code != status {
                t.Fatalf("%s：%d %s", role, got.Code, got.Body.String())
            }
            return nil
        }
        if got.Code != 200 {
            t.Fatalf("%s：%d %s", role, got.Code, got.Body.String())
        }
        if got.Header().Get("X-Request-ID") == "" || got.Header().Get("Cache-Control") != "no-store" {
            t.Fatal("请求元数据缺失")
        }
        return decoded(t, got.Body.Bytes()).(map[string]any)
    }
    listQuery := `query Users($where:UserFilters,$limit:Int,$offset:Int,$order:UserOrderBy){listUsers(where:$where,limit:$limit,offset:$offset,orderBy:$order){id name email role image banned banReason banExpires emailVerified createdAt updatedAt}}`
    for _, role := range append(roles, "") {
        got := performUser(role, listQuery, map[string]any{
            "limit":  2,
            "offset": 0,
            "order":  map[string]any{"id": map[string]any{"direction": "asc", "priority": 1}},
        })
        if got == nil {
            continue
        }
        if got["errors"] != nil {
            t.Fatal(got)
        }

        rows := got["data"].(map[string]any)["listUsers"].([]any)
        first := rows[0].(map[string]any)
        if len(rows) != 2 || first["id"] != "1" || first["createdAt"] != "2026-10-04T01:02:03Z" || first["image"] != nil || first["banExpires"] != nil {
            t.Fatal(got)
        }
    }

    got := performUser("admin", `{getCurrentUser{id email}}`, nil)
    if got["data"].(map[string]any)["getCurrentUser"].(map[string]any)["id"] != "2" {
        t.Fatal(got)
    }

    got = performUser("reader", `{getCurrentUser{id}}`, nil)
    if got["errors"] != nil {
        t.Fatal(got)
    }

    got = performUser("admin", `query($where:UserFilters!){getUser(where:$where){id role}}`, map[string]any{"where": map[string]any{"email": map[string]any{"eq": "owner@example.test"}}})
    if got["errors"] != nil || got["data"].(map[string]any)["getUser"].(map[string]any)["id"] != "1" {
        t.Fatal(got)
    }

    got = performUser("admin", listQuery, map[string]any{"where": map[string]any{"id": map[string]any{"inArray": []int{}}}, "limit": 20})
    if got["errors"] != nil || len(got["data"].(map[string]any)["listUsers"].([]any)) != 0 {
        t.Fatal(got)
    }

    for _, query := range []string{
        `{getUser(where:{id:{eq:1}}){id}}`,
        `{listShops{id}}`,
        `mutation{createShop(set:{name:"测试",slug:"r2"}){id}}`,
    } {
        got = performUser("reader", query, nil)
        err := got["errors"].([]any)[0].(map[string]any)
        if err["extensions"].(map[string]any)["code"] != "FORBIDDEN" {
            t.Fatal(got)
        }
    }

    for _, query := range []string{
        `{getUser(where:{}){id}}`,
        `{listUsers(limit:-1){id}}`,
        `{listUsers(orderBy:{email:{direction:asc,priority:0}}){id}}`,
    } {
        got = performUser("admin", query, nil)
        err := got["errors"].([]any)[0].(map[string]any)
        if err["extensions"].(map[string]any)["code"] != "BAD_USER_INPUT" {
            t.Fatal(got)
        }
    }

    if len(events) == 0 || events[0].ActorID != "1" || events[0].RequestID == "" || events[0].Result != "success" {
        t.Fatal(events)
    }
}

func TestMissingUserServiceControlled(t *testing.T) {
    api := subject.New(newMemory(), subject.Config{})
    got := perform(api, http.MethodPost, subject.AdminPath, `{"query":"{getCurrentUser{id}}"}`, nil)
    if !strings.Contains(got.Body.String(), "SERVICE_UNAVAILABLE") || strings.Contains(got.Body.String(), "Unexpected") {
        t.Fatal(got.Body.String())
    }
}
