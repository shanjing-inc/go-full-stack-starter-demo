package web_test

// 本文件覆盖后台会话身份解析，以及缺失权限服务时的受控错误。

import (
    "context"
    "encoding/json"
    "errors"
    "net/http"
    "net/http/httptest"
    "path/filepath"
    "reflect"
    "strings"
    "sync"
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

// 认证字段与业务字段共用后台 Schema；身份在每次 HTTP 请求开始时固定。
func TestGraphQLAuthenticationLifecycle(t *testing.T) {
    db, err := database.Open(context.Background(), "sqlite", filepath.Join(t.TempDir(), "graphql-auth.sqlite"))
    if err != nil {
        t.Fatal(err)
    }
    sql, _ := db.DB()
    t.Cleanup(func() { _ = sql.Close() })
    if err := db.AutoMigrate(auth.Models()...); err != nil {
        t.Fatal(err)
    }
    if err := db.Create(&auth.Bootstrap{ID: 1}).Error; err != nil {
        t.Fatal(err)
    }
    optionalPaths := []string{subject.AdminPath, subject.MemberPath}
    permissions := auth.DefaultRolePermissions()
    permissions["viewer"] = []auth.Permission{{Resource: "dashboard", Action: "access:admin"}}
    authentication, err := auth.New(db, auth.Config{
        Permissions:       permissions,
        Secret:            "test-secret-with-at-least-32-bytes",
        BootstrapToken:    "bootstrap-test-token-at-least-32-bytes",
        OptionalAuthPaths: optionalPaths,
        Origins:           []string{"http://localhost"},
        AdminPaths:        []string{subject.AdminPath},
    })
    if err != nil {
        t.Fatal(err)
    }
    optionalPaths[0] = "/api/other" // 构造后的混合端点配置保持独立快照。
    api := subject.New(newMemory(), subject.Config{Authentication: authentication, AllowedOrigins: []string{"http://localhost"}})
    limiter := &graphqlAuthLimiter{}
    if err := authentication.Register(api, limiter); err != nil {
        t.Fatal(err)
    }
    call := func(query string, variables map[string]any, cookie string) *httptest.ResponseRecorder {
        raw, _ := json.Marshal(map[string]any{"query": query, "variables": variables})
        headers := map[string]string{"Origin": "http://localhost"}
        if cookie != "" {
            headers["Cookie"] = cookie
        }
        return perform(api, http.MethodPost, subject.AdminPath, string(raw), headers)
    }
    data := func(response *httptest.ResponseRecorder) map[string]any {
        t.Helper()
        body := decoded(t, response.Body.Bytes()).(map[string]any)
        if response.Code != http.StatusOK || body["errors"] != nil {
            t.Fatalf("认证 GraphQL：%d %s", response.Code, response.Body.String())
        }
        return body["data"].(map[string]any)
    }
    code := func(response *httptest.ResponseRecorder, expected string) {
        t.Helper()
        body := decoded(t, response.Body.Bytes()).(map[string]any)
        list, ok := body["errors"].([]any)
        if response.Code != http.StatusOK || !ok || len(list) == 0 {
            t.Fatalf("预期 %s：%d %s", expected, response.Code, response.Body.String())
        }
        if list[0].(map[string]any)["extensions"].(map[string]any)["code"] != expected {
            t.Fatal(body)
        }
    }
    disabled, err := auth.New(db, auth.Config{Secret: "test-secret-with-at-least-32-bytes", Origins: []string{"http://localhost"}, OptionalAuthPaths: []string{subject.AdminPath}})
    if err != nil {
        t.Fatal(err)
    }
    disabledAPI := subject.New(newMemory(), subject.Config{Authentication: disabled, AllowedOrigins: []string{"http://localhost"}})
    if err := disabled.Register(disabledAPI, sessionLimiter{}); err != nil {
        t.Fatal(err)
    }
    disabledStatus := perform(disabledAPI, http.MethodPost, subject.AdminPath, `{"query":"{getInstallStatus{installed enabled}}"}`, nil)
    if got := data(disabledStatus)["getInstallStatus"].(map[string]any); got["installed"] != false || got["enabled"] != false {
        t.Fatal(got)
    }
    code(perform(disabledAPI, http.MethodPost, subject.AdminPath, `{"query":"mutation{initializeAdmin(input:{bootstrapToken:\"anything\",name:\"管理员\",email:\"owner@example.test\",password:\"password-2026\"}){id}}"}`, map[string]string{"Origin": "http://localhost"}), "INSTALL_DISABLED")
    status := `query {getInstallStatus{installed enabled}}`
    if got := data(call(status, nil, ""))["getInstallStatus"].(map[string]any); got["installed"] != false || got["enabled"] != true {
        t.Fatal(got)
    }
    init := `mutation($input: InitializeAdminInput!) {initializeAdmin(input:$input){id email}}`
    input := map[string]any{"name": "测试管理员", "email": "owner@example.test", "password": "owner-password-2026", "bootstrapToken": "invalid"}
    code(call(init, map[string]any{"input": input}, ""), "UNAUTHORIZED")
    input["bootstrapToken"] = "bootstrap-test-token-at-least-32-bytes"
    if got := data(call(init, map[string]any{"input": input}, ""))["initializeAdmin"].(map[string]any); got["email"] != "owner@example.test" {
        t.Fatal(got)
    }
    code(call(init, map[string]any{"input": input}, ""), "ALREADY_INSTALLED")
    if got := data(call(status, nil, ""))["getInstallStatus"].(map[string]any); got["installed"] != true || got["enabled"] != false {
        t.Fatal(got)
    }
    login := `mutation($input: SignInWithEmailInput!){signInWithEmail(input:$input){id email}}`
    credentials := map[string]any{"email": "owner@example.test", "password": "wrong"}
    code(call(login, map[string]any{"input": credentials}, ""), "INVALID_CREDENTIALS")
    credentials["password"] = "owner-password-2026"
    signedIn := call(login, map[string]any{"input": credentials}, "")
    data(signedIn)
    cookies := signedIn.Result().Cookies()
    if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteLaxMode || cookies[0].MaxAge <= 0 {
        t.Fatalf("登录 Cookie：%v", cookies)
    }
    if strings.Contains(signedIn.Body.String(), "token") || strings.Contains(signedIn.Body.String(), "password") {
        t.Fatal("认证响应应只暴露安全用户字段")
    }
    cookie := cookies[0].Name + "=" + cookies[0].Value
    if got := data(call(`{getCurrentUser{email} getCurrentPermissions}`, nil, cookie))["getCurrentUser"].(map[string]any); got["email"] != "owner@example.test" {
        t.Fatal(got)
    }
    for _, query := range []string{
        `{private:getCurrentUser{id}}`,
        `query {...Private} fragment Private on Query {getCurrentUser{id}}`,
        `{getInstallStatus{installed} getCurrentUser{id}}`,
        `{getCurrentPermissions}`,
        `mutation {createShop(set:{name:"越权",slug:"unauthorized"}){id}}`,
    } {
        code(call(query, nil, ""), "UNAUTHORIZED")
    }
    batch := perform(api, http.MethodPost, subject.AdminPath, `[{"query":"{getInstallStatus{installed}}"},{"query":"{getCurrentUser{id}}"}]`, map[string]string{"Origin": "http://localhost"})
    parts := decoded(t, batch.Body.Bytes()).([]any)
    if parts[0].(map[string]any)["errors"] != nil || !strings.Contains(string(batch.Body.Bytes()), "UNAUTHORIZED") {
        t.Fatal(batch.Body.String())
    }
    // 合法登录产生的 Cookie 只供后续 HTTP 请求使用。
    code(call(`mutation($input: SignInWithEmailInput!){signInWithEmail(input:$input){id} createShop(set:{name:"越权",slug:"mixed"}){id}}`, map[string]any{"input": credentials}, ""), "UNAUTHORIZED")
    loginBody, _ := json.Marshal(map[string]any{"query": login, "variables": map[string]any{"input": credentials}})
    loginBatch := perform(api, http.MethodPost, subject.AdminPath, "["+string(loginBody)+`,{"query":"{getCurrentUser{id}}"}]`, map[string]string{"Origin": "http://localhost"})
    if !strings.Contains(loginBatch.Body.String(), "UNAUTHORIZED") || len(loginBatch.Result().Cookies()) != 1 {
        t.Fatal(loginBatch.Body.String(), loginBatch.Header())
    }

    // Cookie 写请求要求合法 Origin；匿名认证写操作同样校验来源。
    for _, headers := range []map[string]string{
        {}, {"Origin": "https://evil.example"}, {"Origin": "http://localhost", "Sec-Fetch-Site": "cross-site"},
    } {
        response := perform(api, http.MethodPost, subject.AdminPath, string(loginBody), headers)
        if response.Code != http.StatusForbidden {
            code(response, "FORBIDDEN")
        }
        if len(response.Result().Cookies()) != 0 {
            t.Fatal("来源拒绝后仍写入 Cookie")
        }
    }
    badPassword := map[string]any{"email": "owner@example.test", "password": strings.Repeat("汉", 171)}
    code(call(login, map[string]any{"input": badPassword}, ""), "BAD_USER_INPUT")
    // 后台门禁、资源权限、会话期限及封禁在每次请求复核。
    role := "member"
    limited := auth.User{Name: "普通成员", Email: "member@example.test", Role: &role}
    if err := db.Create(&limited).Error; err != nil {
        t.Fatal(err)
    }
    limitedSession := auth.Session{UserID: limited.ID, Token: "member-token", ExpiresAt: time.Now().Add(time.Hour)}
    if err := db.Create(&limitedSession).Error; err != nil {
        t.Fatal(err)
    }
    code(perform(api, http.MethodPost, subject.AdminPath, `{"query":"{getCurrentPermissions}"}`, map[string]string{"Authorization": "Bearer member-token", "Origin": "http://localhost"}), "FORBIDDEN")
    if err := db.Model(&auth.User{}).Where("id = ?", limited.ID).Update("role", "viewer").Error; err != nil {
        t.Fatal(err)
    }
    viewerHeaders := map[string]string{"Authorization": "Bearer member-token", "Origin": "http://localhost"}
    data(perform(api, http.MethodPost, subject.AdminPath, `{"query":"{getCurrentPermissions}"}`, viewerHeaders))
    code(perform(api, http.MethodPost, subject.AdminPath, `{"query":"{listUsers{id}}"}`, viewerHeaders), "FORBIDDEN")
    if err := db.Model(&auth.User{}).Where("email = ?", "owner@example.test").Update("banned", true).Error; err != nil {
        t.Fatal(err)
    }
    code(call(`{getCurrentUser{id}}`, nil, cookie), "USER_BANNED")
    code(call(login, map[string]any{"input": credentials}, ""), "USER_BANNED")
    if err := db.Model(&auth.User{}).Where("email = ?", "owner@example.test").Update("banned", false).Error; err != nil {
        t.Fatal(err)
    }
    if err := db.Model(&auth.Session{}).Where("user_id != ?", limited.ID).Update("expires_at", time.Now().Add(-time.Hour)).Error; err != nil {
        t.Fatal(err)
    }
    code(call(`{getCurrentPermissions}`, nil, cookie), "UNAUTHORIZED")
    if err := db.Model(&auth.Session{}).Where("user_id != ?", limited.ID).Update("expires_at", time.Now().Add(time.Hour)).Error; err != nil {
        t.Fatal(err)
    }

    // 六个别名和六个 batch 元素分别计入共享账号桶。
    limiter.reset(true, nil)
    aliasQuery := `mutation($input:SignInWithEmailInput!){`
    for _, alias := range []string{"a", "b", "c", "d", "e", "f"} {
        aliasQuery += alias + `:signInWithEmail(input:$input){id} `
    }
    code(call(aliasQuery+`}`, map[string]any{"input": credentials}, ""), "RATE_LIMITED")
    if limiter.count(5) != 6 {
        t.Fatal("别名登录计数", limiter.count(5))
    }
    limiter.reset(true, nil)
    batchLogins := "[" + strings.TrimSuffix(strings.Repeat(string(loginBody)+",", 6), ",") + "]"
    throttled := perform(api, http.MethodPost, subject.AdminPath, batchLogins, map[string]string{"Origin": "http://localhost"})
    if !strings.Contains(throttled.Body.String(), "RATE_LIMITED") || throttled.Header().Get("Retry-After") != "60" || limiter.count(5) != 6 {
        t.Fatal(throttled.Body.String(), throttled.Header(), limiter.count(5))
    }
    limiter.reset(false, errors.New("redis://private:secret@internal:6379"))
    unavailable := call(login, map[string]any{"input": credentials}, "")
    code(unavailable, "SERVICE_UNAVAILABLE")
    if strings.Contains(unavailable.Body.String(), "secret") || strings.Contains(unavailable.Body.String(), "redis") {
        t.Fatal("基础设施错误泄露", unavailable.Body.String())
    }
    limiter.reset(false, nil)

    signedOut := call(`mutation {signOut}`, nil, cookie)
    if data(signedOut)["signOut"] != true {
        t.Fatal(signedOut.Body.String())
    }
    cleared := signedOut.Result().Cookies()
    if len(cleared) == 0 || cleared[len(cleared)-1].MaxAge != -1 {
        t.Fatalf("退出 Cookie：%v", cleared)
    }
    code(call(`{getCurrentUser{id}}`, nil, cookie), "UNAUTHORIZED")
    if data(call(`mutation {signOut}`, nil, cookie))["signOut"] != true {
        t.Fatal("退出保持幂等")
    }
    // Member 登录为小程序返回独立 Bearer token，后台 Cookie 与成员 token 保持分离。
    memberCall := func(query string, variables map[string]any, headers map[string]string) *httptest.ResponseRecorder {
        raw, _ := json.Marshal(map[string]any{"query": query, "variables": variables})
        return perform(api, http.MethodPost, subject.MemberPath, string(raw), headers)
    }
    memberLogin := `mutation($input:MemberSignInInput!){signInWithEmail(input:$input){token}}`
    memberInput := map[string]any{"input": credentials}
    code(memberCall(`{getShop(where:{id:{eq:1}}){id}}`, nil, nil), "UNAUTHORIZED")
    // 旧 REST 入口在匿名与有效会话下均返回 404。
    removedEndpoints := []struct{ method, path string }{
        {"GET", "/api/auth/install-status"}, {"POST", "/api/auth/initialize"},
        {"POST", "/api/auth/sign-in/email"}, {"GET", "/api/auth/get-session"},
        {"POST", "/api/auth/sign-out"}, {"GET", "/api/rest/demo/overview"}, {"GET", "/api/rest/demo/session"},
    }
    for _, removed := range removedEndpoints {
        if response := perform(api, removed.method, removed.path, "{}", nil); response.Code != http.StatusNotFound {
            t.Fatalf("旧入口 %s %s：%d %s", removed.method, removed.path, response.Code, response.Body.String())
        }
    }
    memberSignedIn := memberCall(memberLogin, memberInput, nil)
    bearer := data(memberSignedIn)["signInWithEmail"].(map[string]any)["token"].(string)
    if bearer == "" || len(memberSignedIn.Result().Cookies()) != 0 {
        t.Fatal("成员登录仅返回 Bearer 会话")
    }
    if memberSignedIn.Header().Get("Cache-Control") != "no-store" {
        t.Fatal("成员登录响应需要禁止缓存")
    }
    memberHeaders := map[string]string{"Authorization": "Bearer " + bearer}
    data(memberCall(`{getShop(where:{id:{eq:1}}){id}}`, nil, memberHeaders))
    for _, removed := range removedEndpoints {
        if response := perform(api, removed.method, removed.path, "{}", memberHeaders); response.Code != http.StatusNotFound {
            t.Fatal(removed.path, response.Code)
        }
    }
    // Cookie 会话通过 Admin Schema 工作，Member 写入口拒绝 Cookie 与跨站来源。
    adminCookieLogin := call(login, map[string]any{"input": credentials}, "")
    data(adminCookieLogin)
    adminSessionCookie := adminCookieLogin.Result().Cookies()[0]
    adminCookie := adminSessionCookie.Name + "=" + adminSessionCookie.Value
    for _, headers := range []map[string]string{
        {"Cookie": adminCookie, "Origin": "http://localhost"},
        {"Origin": "https://evil.example"}, {"Sec-Fetch-Site": "cross-site"},
    } {
        for _, query := range []string{memberLogin, `mutation{signOut}`} {
            response := memberCall(query, memberInput, headers)
            if response.Code != http.StatusForbidden {
                code(response, "FORBIDDEN")
            }
        }
    }
    // Member 与 Admin 登录共用同一账号桶，连续调用与批量请求逐操作计数。
    limiter.reset(true, nil)
    for i := 0; i < 5; i++ {
        data(memberCall(memberLogin, memberInput, nil))
    }
    code(call(login, map[string]any{"input": credentials}, ""), "RATE_LIMITED")
    limiter.reset(true, nil)
    memberBody, _ := json.Marshal(map[string]any{"query": memberLogin, "variables": memberInput})
    memberBatch := "[" + strings.TrimSuffix(strings.Repeat(string(memberBody)+",", 6), ",") + "]"
    memberThrottled := perform(api, http.MethodPost, subject.MemberPath, memberBatch, nil)
    if !strings.Contains(memberThrottled.Body.String(), "RATE_LIMITED") || limiter.count(5) != 6 {
        t.Fatal(memberThrottled.Body.String())
    }
    limiter.reset(false, nil)
    data(memberCall(`mutation{signOut}`, nil, memberHeaders))
    code(memberCall(`{getShop(where:{id:{eq:1}}){id}}`, nil, memberHeaders), "UNAUTHORIZED")
    data(memberCall(`mutation{signOut}`, nil, memberHeaders))
    // 成员退出仅撤销自身 Bearer 会话。
    data(call(`{getCurrentUser{id}}`, nil, adminCookie))
    if err := db.Model(&auth.User{}).Where("email = ?", "owner@example.test").Update("banned", true).Error; err != nil {
        t.Fatal(err)
    }
    code(memberCall(memberLogin, memberInput, nil), "USER_BANNED")
}

// graphqlAuthLimiter 记录每个逻辑操作的桶访问，用于 alias 与 batch 防绕过回归。
type graphqlAuthLimiter struct {
    mu      sync.Mutex
    enabled bool
    failure error
    keys    map[string]int
    calls   map[int]int
}

func (l *graphqlAuthLimiter) Allow(_ context.Context, key string, limit int) (bool, error) {
    l.mu.Lock()
    defer l.mu.Unlock()
    if l.failure != nil {
        return false, l.failure
    }
    if !l.enabled {
        return true, nil
    }
    l.keys[key]++
    l.calls[limit]++
    return l.keys[key] <= limit, nil
}
func (l *graphqlAuthLimiter) reset(enabled bool, err error) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.enabled, l.failure = enabled, err
    l.keys, l.calls = map[string]int{}, map[int]int{}
}
func (l *graphqlAuthLimiter) count(limit int) int {
    l.mu.Lock()
    defer l.mu.Unlock()
    return l.calls[limit]
}
