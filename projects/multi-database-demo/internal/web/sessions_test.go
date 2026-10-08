package server_test

// 本文件覆盖后台会话列表和撤销操作的 GraphQL 契约。

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "path/filepath"
    "strings"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
)

func TestAdminSessionManagement(t *testing.T) {
    db, err := database.Open(context.Background(), "sqlite", filepath.Join(t.TempDir(), "sessions.sqlite"))
    if err != nil {
        t.Fatal(err)
    }

    sql, _ := db.DB()
    t.Cleanup(func() { _ = sql.Close() })
    if err = db.AutoMigrate(auth.Models()...); err != nil {
        t.Fatal(err)
    }
    if err = db.Create(&auth.Bootstrap{ID: 1}).Error; err != nil {
        t.Fatal(err)
    }

    roles := []string{"owner", "admin", "reader", "user"}
    tokens := map[string]string{}
    ids := map[string]int{}
    for i, role := range roles {
        user := auth.User{
            ID:    i + 1,
            Name:  role,
            Email: role + "@example.test",
            Role:  &role,
        }
        if err = db.Create(&user).Error; err != nil {
            t.Fatal(err)
        }

        row := auth.Session{
            UserID:    user.ID,
            Token:     role + "-private-token",
            ExpiresAt: time.Now().Add(time.Hour),
            UserAgent: stringPointer("浏览器 <script>"),
            IPAddress: stringPointer("127.0.0.1"),
        }
        if err = db.Create(&row).Error; err != nil {
            t.Fatal(err)
        }

        tokens[role], ids[role] = row.Token, row.ID
    }

    extra := auth.Session{
        UserID:    2,
        Token:     "second-private-token",
        ExpiresAt: time.Now().Add(time.Hour),
    }
    if err = db.Create(&extra).Error; err != nil {
        t.Fatal(err)
    }

    policies := auth.DefaultRolePermissions()
    policies["reader"] = []auth.Permission{{Resource: "dashboard", Action: "access:admin"}, {Resource: "session", Action: "list"}}
    authentication, err := auth.New(db, auth.Config{
        Secret:      "test-secret-with-at-least-32-bytes",
        Permissions: policies,
        AdminPaths:  []string{subject.AdminPath},
    })
    if err != nil {
        t.Fatal(err)
    }

    api := subject.New(newMemory(), subject.Config{Authentication: authentication})
    api.Use(authentication.Guard)
    request := func(actor, query string, variables map[string]any) map[string]any {
        t.Helper()
        raw, _ := json.Marshal(map[string]any{"query": query, "variables": variables})
        response := perform(api, http.MethodPost, subject.AdminPath, string(raw), map[string]string{"Authorization": "Bearer " + tokens[actor]})
        if response.Code != 200 {
            t.Fatalf("%d %s", response.Code, response.Body.String())
        }
        if strings.Contains(response.Body.String(), "private-token") {
            t.Fatal("响应包含令牌")
        }
        return decoded(t, response.Body.Bytes()).(map[string]any)
    }
    requireCode := func(body map[string]any, code string) {
        t.Helper()
        list, ok := body["errors"].([]any)
        if !ok || len(list) == 0 {
            t.Fatal(body)
        }

        item := list[0].(map[string]any)
        if item["extensions"].(map[string]any)["code"] != code {
            t.Fatal(body)
        }
    }
    query := `query($id:ID!,$limit:Int,$offset:Int){listUserSessions(userId:$id,limit:$limit,offset:$offset){id userId ipAddress userAgent createdAt updatedAt expiresAt current}}`
    mutation := `mutation($uid:ID!,$sid:ID!){revokeUserSession(userId:$uid,sessionId:$sid)}`
    result := request("admin", query, map[string]any{"id": "2"})
    if result["errors"] != nil {
        t.Fatal(result)
    }

    rows := result["data"].(map[string]any)["listUserSessions"].([]any)
    if len(rows) != 2 {
        t.Fatal(result)
    }

    currentCount := 0
    for _, v := range rows {
        row := v.(map[string]any)
        if row["current"] == true {
            currentCount++
            if row["id"] != fmt.Sprint(ids["admin"]) {
                t.Fatal(row)
            }
        }
    }

    if currentCount != 1 {
        t.Fatal(result)
    }
    // 管理员查看他人会话时保持 current=false；仅有列表权限也能查询低权限账号。
    result = request("reader", query, map[string]any{"id": "4"})
    if result["errors"] != nil || result["data"].(map[string]any)["listUserSessions"].([]any)[0].(map[string]any)["current"] != false {
        t.Fatal(result)
    }
    requireCode(request("reader", mutation, map[string]any{"uid": "4", "sid": fmt.Sprint(ids["user"])}), "FORBIDDEN")
    requireCode(request("admin", query, map[string]any{"id": "1"}), "FORBIDDEN")
    requireCode(request("admin", mutation, map[string]any{"uid": "1", "sid": fmt.Sprint(ids["owner"])}), "FORBIDDEN")
    for _, id := range []string{"0", "-1", "bad", "2147483648"} {
        requireCode(request("admin", query, map[string]any{"id": id}), "BAD_USER_INPUT")
        requireCode(request("admin", mutation, map[string]any{"uid": "2", "sid": id}), "BAD_USER_INPUT")
    }

    for _, params := range []map[string]any{
        {"id": "2", "limit": 0},
        {"id": "2", "limit": 102},
        {"id": "2", "offset": -1},
    } {
        requireCode(request("admin", query, params), "BAD_USER_INPUT")
    }

    result = request("admin", query, map[string]any{"id": "2", "limit": 1, "offset": 1})
    if result["errors"] != nil || len(result["data"].(map[string]any)["listUserSessions"].([]any)) != 1 {
        t.Fatal(result)
    }

    result = request("admin", `{listUserSessions(userId:"2"){token}}`, nil)
    if result["errors"] == nil {
        t.Fatal("SDL 暴露 token")
    }

    for range 2 {
        result = request("admin", mutation, map[string]any{"uid": "2", "sid": fmt.Sprint(extra.ID)})
        if result["errors"] != nil || result["data"].(map[string]any)["revokeUserSession"] != true {
            t.Fatal(result)
        }
    }

    if _, _, err = authentication.Resolve(context.Background(), tokens["admin"]); err != nil {
        t.Fatal(err)
    }

    result = request("admin", mutation, map[string]any{"uid": "2", "sid": fmt.Sprint(ids["admin"])})
    if result["errors"] != nil {
        t.Fatal(result)
    }

    raw, _ := json.Marshal(map[string]any{"query": query, "variables": map[string]any{"id": "2"}})
    response := perform(api, http.MethodPost, subject.AdminPath, string(raw), map[string]string{"Authorization": "Bearer " + tokens["admin"]})
    if response.Code != 401 {
        t.Fatalf("自身会话撤销后 %d %s", response.Code, response.Body.String())
    }
}

func stringPointer(value string) *string { return &value }
