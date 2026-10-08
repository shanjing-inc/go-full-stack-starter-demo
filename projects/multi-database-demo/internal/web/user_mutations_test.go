package server_test

// 本文件覆盖后台用户创建、更新及会话撤销的 GraphQL 契约。

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "path/filepath"
    "strings"
    "testing"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
)

func TestAdminUserMutations(t *testing.T) {
    db, err := database.Open(context.Background(), "sqlite", filepath.Join(t.TempDir(), "mutations.sqlite"))
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

    const secret = "test-secret-with-at-least-32-bytes"
    var events []auth.AuditEvent
    policies := auth.DefaultRolePermissions()
    policies["reader"] = []auth.Permission{{Resource: "dashboard", Action: "access:admin"}, {Resource: "user", Action: "list"}}
    service, err := auth.New(db, auth.Config{
        Secret:         secret,
        BootstrapToken: secret,
        AdminPaths:     []string{subject.AdminPath},
        Permissions:    policies,
        Audit:          func(_ context.Context, event auth.AuditEvent) { events = append(events, event) },
    })
    if err != nil {
        t.Fatal(err)
    }

    owner, err := service.Initialize(context.Background(), secret, "owner", "owner@example.test", "password-for-2026")
    if err != nil {
        t.Fatal(err)
    }

    ctx := auth.WithUser(context.Background(), owner)
    adminRole := "admin"
    admin, err := service.CreateUser(ctx, auth.CreateUserInput{
        Name:     "admin",
        Email:    "admin@example.test",
        Password: "password-for-2026",
        Role:     &adminRole,
    })
    if err != nil {
        t.Fatal(err)
    }

    readerRole := "reader"
    _, err = service.CreateUser(ctx, auth.CreateUserInput{
        Name:     "reader",
        Email:    "reader@example.test",
        Password: "password-for-2026",
        Role:     &readerRole,
    })
    if err != nil {
        t.Fatal(err)
    }

    api := subject.New(newMemory(), subject.Config{Authentication: service})
    api.Use(service.Guard)
    tokens := map[string]string{}
    for _, role := range []string{"owner", "admin", "reader"} {
        session, _, err := service.Login(context.Background(), role+"@example.test", "password-for-2026", "", "")
        if err != nil {
            t.Fatal(err)
        }

        tokens[role] = session.Token
    }

    request := func(actor, query string, variables map[string]any) map[string]any {
        raw, _ := json.Marshal(map[string]any{"query": query, "variables": variables})
        response := perform(api, http.MethodPost, subject.AdminPath, string(raw), map[string]string{"Authorization": "Bearer " + tokens[actor]})
        if response.Code != 200 {
            t.Fatalf("%d %s", response.Code, response.Body.String())
        }
        if strings.Contains(response.Body.String(), "password-for-2026") || strings.Contains(response.Body.String(), "credential") {
            t.Fatal("凭据泄漏")
        }
        return decoded(t, response.Body.Bytes()).(map[string]any)
    }
    requireCode := func(body map[string]any, code string) {
        t.Helper()
        list, ok := body["errors"].([]any)
        if !ok || len(list) == 0 {
            t.Fatal(body)
        }

        item, _ := list[0].(map[string]any)
        extensions, _ := item["extensions"].(map[string]any)
        if extensions["code"] != code {
            t.Fatal(body)
        }
    }
    create := `mutation($set:CreateUserSetInput!){createUser(set:$set){id name email role emailVerified}}`
    update := `mutation($set:UpdateUserSetInput!,$where:UserFilters!){updateUser(set:$set,where:$where){id name role banned banReason banExpires}}`
    revoke := `mutation($id:ID!){revokeUserSessions(userId:$id)}`
    input := map[string]any{"set": map[string]any{
        "name":     "测试用户",
        "email":    "new@example.test",
        "password": "12345678",
        "role":     "member",
    }}
    requireCode(request("reader", create, input), "FORBIDDEN")
    body := request("admin", create, input)
    if body["errors"] != nil {
        t.Fatal(body)
    }

    row := body["data"].(map[string]any)["createUser"].([]any)[0].(map[string]any)
    var id int
    fmt.Sscan(fmt.Sprint(row["id"]), &id)
    if row["role"] != "member" || row["emailVerified"] != false || id <= 0 {
        t.Fatal(row)
    }
    requireCode(request("owner", create, input), "BAD_USER_INPUT")
    where := map[string]any{"id": map[string]any{"eq": id}}
    ownerWhere := map[string]any{"id": map[string]any{"eq": owner.ID}}
    requireCode(request("admin", update, map[string]any{"where": ownerWhere, "set": map[string]any{"name": "越权"}}), "FORBIDDEN")
    requireCode(request("reader", update, map[string]any{"where": where, "set": map[string]any{"name": "越权"}}), "FORBIDDEN")
    requireCode(request("admin", update, map[string]any{"where": where, "set": map[string]any{"role": "owner"}}), "FORBIDDEN")
    requireCode(request("admin", update, map[string]any{"where": map[string]any{}, "set": map[string]any{"name": "全表"}}), "BAD_USER_INPUT")
    invalid := request("admin", update, map[string]any{"where": where, "set": map[string]any{"email": "forged@example.test"}})
    if list, ok := invalid["errors"].([]any); !ok || len(list) == 0 {
        t.Fatal("未知输入字段需要拒绝", invalid)
    }

    var unchanged auth.User
    if err = db.First(&unchanged, id).Error; err != nil || unchanged.Email != "new@example.test" {
        t.Fatal(unchanged, err)
    }

    ban := request("admin", update, map[string]any{
        "where": where,
        "set": map[string]any{
            "banned":     true,
            "banReason":  "人工封禁",
            "banExpires": "2099-10-04T00:00:00Z",
        },
    })
    if ban["errors"] != nil {
        t.Fatal(ban)
    }
    // 省略字段保持原封禁信息。
    edit := request("admin", update, map[string]any{"where": where, "set": map[string]any{"name": "编辑资料"}})
    if edit["errors"] != nil {
        t.Fatal(edit)
    }

    row = edit["data"].(map[string]any)["updateUser"].([]any)[0].(map[string]any)
    if row["banReason"] != "人工封禁" || row["banExpires"] == nil {
        t.Fatal(row)
    }

    unban := request("admin", update, map[string]any{"where": where, "set": map[string]any{"banned": false, "banReason": nil, "banExpires": nil}})
    if unban["errors"] != nil {
        t.Fatal(unban)
    }

    row = unban["data"].(map[string]any)["updateUser"].([]any)[0].(map[string]any)
    if row["banReason"] != nil || row["banExpires"] != nil || row["banned"] != false {
        t.Fatal(row)
    }

    session, _, err := service.Login(context.Background(), "new@example.test", "12345678", "", "")
    if err != nil {
        t.Fatal(err)
    }
    requireCode(request("reader", revoke, map[string]any{"id": fmt.Sprint(id)}), "FORBIDDEN")
    requireCode(request("admin", revoke, map[string]any{"id": fmt.Sprint(owner.ID)}), "FORBIDDEN")
    requireCode(request("admin", revoke, map[string]any{"id": "2147483648"}), "BAD_USER_INPUT")
    body = request("admin", revoke, map[string]any{"id": fmt.Sprint(id)})
    if body["errors"] != nil || body["data"].(map[string]any)["revokeUserSessions"] != true {
        t.Fatal(body)
    }

    response := perform(api, http.MethodPost, subject.AdminPath, `{"query":"{getCurrentUser{id}}"}`, map[string]string{"Authorization": "Bearer " + session.Token})
    if response.Code != 401 {
        t.Fatal(response.Code, response.Body.String())
    }

    for _, event := range events {
        if event.ActorID == fmt.Sprint(admin.ID) && event.Action == "revoke" && event.Result == "success" && event.RequestID != "" {
            return
        }
    }

    t.Fatal("管理操作缺少请求关联审计")
}
