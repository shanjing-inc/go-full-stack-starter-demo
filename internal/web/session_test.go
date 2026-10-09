package server_test

// 本文件覆盖后台会话身份解析，以及缺失权限服务时的受控错误。

import (
    "context"
    "net/http"
    "path/filepath"
    "reflect"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
)

func TestDashboardGraphQLSession(t *testing.T) {
    db, err := database.Open(context.Background(), "sqlite", filepath.Join(t.TempDir(), "sessions.sqlite"))
    if err != nil {
        t.Fatal(err)
    }

    sql, _ := db.DB()
    t.Cleanup(func() { _ = sql.Close() })
    if err := db.AutoMigrate(auth.Models()...); err != nil {
        t.Fatal(err)
    }

    role := "limited"
    user := auth.User{
        ID:    1,
        Name:  "低权限后台用户",
        Email: "limited@example.test",
        Role:  &role,
    }
    if err := db.Create(&user).Error; err != nil {
        t.Fatal(err)
    }

    session := auth.Session{
        UserID:    1,
        Token:     "limited-token",
        ExpiresAt: time.Now().Add(time.Hour),
    }
    if err := db.Create(&session).Error; err != nil {
        t.Fatal(err)
    }

    authentication, err := auth.New(db, auth.Config{
        Secret:               "test-secret-with-at-least-32-bytes",
        Origins:              []string{"http://localhost"},
        AdminPaths:           []string{subject.AdminPath},
        DashboardPath:        "/api/rest/demo/session",
        Permissions:          auth.RolePermissions{"limited": {{Resource: "dashboard", Action: "access:admin"}}},
        DashboardPermissions: func(*auth.User) []string { return []string{"demo:read", "demo:read"} },
    })
    if err != nil {
        t.Fatal(err)
    }

    api := subject.New(newMemory(), subject.Config{Authentication: authentication})
    api.Use(authentication.Guard)
    if err := authentication.Register(api, sessionLimiter{}); err != nil {
        t.Fatal(err)
    }

    query := `{"query":"query getDashboardSession {getCurrentUser{id name email image role} getCurrentPermissions}"}`
    headers := map[string]string{"Authorization": "Bearer limited-token"}
    got := perform(api, http.MethodPost, subject.AdminPath, query, headers)
    if got.Code != 200 {
        t.Fatal(got.Code, got.Body.String())
    }

    body := decoded(t, got.Body.Bytes()).(map[string]any)
    if body["errors"] != nil {
        t.Fatal(body)
    }

    data := body["data"].(map[string]any)
    if data["getCurrentUser"].(map[string]any)["id"] != "1" {
        t.Fatal(data)
    }

    want := []any{"dashboard:access:admin", "demo:read"}
    if !reflect.DeepEqual(data["getCurrentPermissions"], want) {
        t.Fatal(data)
    }

    rest := perform(api, http.MethodGet, "/api/rest/demo/session", "", headers)
    restBody := decoded(t, rest.Body.Bytes()).(map[string]any)
    if rest.Code != 200 || !reflect.DeepEqual(restBody["permissions"], want) {
        t.Fatal(rest.Code, restBody)
    }

    list := perform(api, http.MethodPost, subject.AdminPath, `{"query":"{listUsers{id}}"}`, headers)
    if decoded(t, list.Body.Bytes()).(map[string]any)["errors"] == nil {
        t.Fatal("低权限用户列表门禁缺失")
    }

    for _, token := range []string{"", "unknown-token"} {
        response := perform(api, http.MethodPost, subject.AdminPath, query, map[string]string{"Authorization": "Bearer " + token})
        if response.Code != 401 {
            t.Fatal(response.Code, response.Body.String())
        }
    }

    changed := db.Model(&auth.Session{}).Where("id = ?", session.ID).Update("expires_at", time.Now().Add(-time.Hour).UTC())
    if changed.Error != nil || changed.RowsAffected != 1 {
        t.Fatal(changed.Error, changed.RowsAffected, session.ID)
    }

    var saved auth.Session
    if err := db.First(&saved, session.ID).Error; err != nil {
        t.Fatal(err)
    }
    if saved.ExpiresAt.After(time.Now()) {
        t.Fatal("期限更新失败", saved.ExpiresAt)
    }

    expired := perform(api, http.MethodPost, subject.AdminPath, query, headers)
    if expired.Code != 401 {
        t.Fatal(expired.Code, expired.Body.String())
    }
    if err := db.Model(&auth.Session{}).Where("token = ?", session.Token).Update("expires_at", time.Now().Add(time.Hour).UTC()).Error; err != nil {
        t.Fatal(err)
    }
    if err := db.Model(&auth.User{}).Where("id = ?", user.ID).Update("banned", true).Error; err != nil {
        t.Fatal(err)
    }

    banned := perform(api, http.MethodPost, subject.AdminPath, query, headers)
    if banned.Code != 403 || decoded(t, banned.Body.Bytes()).(map[string]any)["code"] != "USER_BANNED" {
        t.Fatal(banned.Code, banned.Body.String())
    }
}

func TestMissingPermissionServiceControlled(t *testing.T) {
    api := subject.New(newMemory(), subject.Config{})
    response := perform(api, http.MethodPost, subject.AdminPath, `{"query":"{getCurrentPermissions}"}`, nil)
    body := decoded(t, response.Body.Bytes()).(map[string]any)
    errors := body["errors"].([]any)
    if errors[0].(map[string]any)["extensions"].(map[string]any)["code"] != "SERVICE_UNAVAILABLE" {
        t.Fatal(body)
    }
}

// 本测试只调用身份查询，认证写入口的限流契约由 auth 测试覆盖。
type sessionLimiter struct{}

func (sessionLimiter) Allow(context.Context, string, int) (bool, error) { return true, nil }
