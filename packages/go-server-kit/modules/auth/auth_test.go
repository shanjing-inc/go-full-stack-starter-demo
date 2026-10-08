package auth

// 本文件覆盖兼容密码、初始化并发与回滚、会话封禁、HTTP 输入及共享限流；外部数据库与 Redis 用例按环境条件运行。

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httpx"
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "github.com/labstack/echo/v5"
    "github.com/redis/go-redis/v9"
    "gorm.io/gorm"
    "net/http"
    "net/http/httptest"
    "os"
    "path/filepath"
    "strings"
    "sync"
    "testing"
    "time"
)

const secret = "test-secret-with-at-least-32-bytes"

const password = "owner-password-2026"

func testDB(t *testing.T, driver, dsn string) *gorm.DB {
    t.Helper()
    db, err := database.Open(context.Background(), driver, dsn)
    if err != nil {
        t.Fatal(err)
    }

    sql, _ := db.DB()
    t.Cleanup(func() { _ = sql.Close() })
    if err = db.AutoMigrate(Models()...); err != nil {
        t.Fatal(err)
    }
    if err = db.Where(Bootstrap{ID: 1}).FirstOrCreate(&Bootstrap{ID: 1}).Error; err != nil {
        t.Fatal(err)
    }
    return db
}

func testService(t *testing.T) *Service {
    t.Helper()
    db := testDB(t, "sqlite", filepath.Join(t.TempDir(), "auth.sqlite"))
    service, err := New(db, Config{
        Secret:         secret,
        BootstrapToken: secret,
        Origins:        []string{"http://localhost"},
        DashboardPath:  "/api/rest/demo/session",
        AdminPaths:     []string{"/api/graphql/admin", "/api/rest/demo/tasks"},
    })
    if err != nil {
        t.Fatal(err)
    }
    return service
}

func initialize(t *testing.T, s *Service) *User {
    t.Helper()
    user, err := s.Initialize(context.Background(), secret, "管理员", "OWNER@example.com", password)
    if err != nil {
        t.Fatal(err)
    }
    return user
}

func TestReferencePasswordAndSession(t *testing.T) {
    s := testService(t)
    raw, err := os.ReadFile("fixtures/better-auth-1.6.24.json")
    if err != nil {
        t.Fatal(err)
    }

    var fixture struct{ Password, Normalized, Hash, Token, Cookie string }
    if json.Unmarshal(raw, &fixture) != nil {
        t.Fatal("样本无效")
    }
    if !PasswordMatches(fixture.Hash, fixture.Password) || !PasswordMatches(fixture.Hash, fixture.Normalized) || PasswordMatches(fixture.Hash, "wrong") {
        t.Fatal("旧密码兼容失败")
    }
    if s.unsigned(fixture.Cookie) != fixture.Token {
        t.Fatal("旧 Cookie 签名兼容失败")
    }

    role := "owner"
    user := User{Name: "迁移用户", Email: "legacy@example.com", Role: &role}
    if err = s.db.Create(&user).Error; err != nil {
        t.Fatal(err)
    }

    account := Account{
        AccountID:  fmt.Sprint(user.ID),
        ProviderID: "credential",
        UserID:     user.ID,
        Password:   &fixture.Hash,
    }
    if err = s.db.Create(&account).Error; err != nil {
        t.Fatal(err)
    }

    _, got, err := s.Login(context.Background(), user.Email, fixture.Password, "", "")
    if err != nil || got.ID != user.ID {
        t.Fatal(err)
    }

    session := Session{
        UserID:    user.ID,
        Token:     fixture.Token,
        ExpiresAt: time.Now().Add(time.Hour),
    }
    if err = s.db.Create(&session).Error; err != nil {
        t.Fatal(err)
    }
    if _, _, err = s.Resolve(context.Background(), s.unsigned(fixture.Cookie)); err != nil {
        t.Fatal(err)
    }
}

func TestPasswordValidation(t *testing.T) {
    for _, hash := range []string{
        "",
        "x:y",
        strings.Repeat("x", 32) + ":" + strings.Repeat("z", 128),
        "bad:bad:bad",
    } {
        if PasswordMatches(hash, password) {
            t.Fatal("畸形散列通过")
        }
    }

    if _, err := PasswordHash("short"); err == nil {
        t.Fatal("短密码通过")
    }

    hash, err := PasswordHash(password)
    if err != nil || !PasswordMatches(hash, password) {
        t.Fatal(err)
    }
}

func TestInitializationGuards(t *testing.T) {
    s := testService(t)
    ctx := context.Background()
    if _, err := s.Initialize(ctx, "bad", "管理员", "owner@example.com", password); !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }
    if _, err := s.Initialize(ctx, secret, "管理员", "invalid", password); err == nil {
        t.Fatal("非法邮箱通过")
    }
    initialize(t, s)
    if _, err := s.Initialize(ctx, secret, "其他人", "another@example.com", password); !errors.Is(err, ErrInstalled) {
        t.Fatal(err)
    }

    s.config.BootstrapToken = ""
    if _, err := s.Initialize(ctx, secret, "管理员", "owner@example.com", password); !errors.Is(err, ErrDisabled) {
        t.Fatal(err)
    }
}

func concurrency(t *testing.T, first, second *Service) {
    t.Helper()
    var wg sync.WaitGroup
    results := make(chan error, 2)
    for i, s := range []*Service{first, second} {
        wg.Add(1)
        go func(i int, s *Service) {
            defer wg.Done()
            _, err := s.Initialize(context.Background(), secret, "管理员", fmt.Sprintf("concurrent%d@example.com", i), password)
            results <- err
        }(i, s)
    }

    wg.Wait()
    close(results)
    success, conflict := 0, 0
    for err := range results {
        if err == nil {
            success++
        } else if errors.Is(err, ErrInstalled) {
            conflict++
        } else {
            t.Fatal(err)
        }
    }

    if success != 1 || conflict != 1 {
        t.Fatal(success, conflict)
    }

    var count int64
    first.db.Model(&User{}).Where("role = ?", "owner").Count(&count)
    if count != 1 {
        t.Fatal(count)
    }
}

func TestConcurrentInitializationSQLite(t *testing.T) {
    dsn := filepath.Join(t.TempDir(), "concurrent.sqlite") + "?_pragma=busy_timeout(5000)"
    db1, db2 := testDB(t, "sqlite", dsn), testDB(t, "sqlite", dsn)
    first, _ := New(db1, Config{Secret: secret, BootstrapToken: secret})
    second, _ := New(db2, Config{Secret: secret, BootstrapToken: secret})
    concurrency(t, first, second)
}

func TestMySQLConcurrentInitialization(t *testing.T) {
    dsn := os.Getenv("MYSQL_AUTH_TEST_DSN")
    if dsn == "" {
        t.Skip("需要 MYSQL_AUTH_TEST_DSN 指定独立认证测试库")
    }
    runDatabaseConcurrentInitialization(t, "mysql", dsn)
}

func TestPostgreSQLConcurrentInitialization(t *testing.T) {
    dsn := os.Getenv("POSTGRES_AUTH_TEST_DSN")
    if dsn == "" {
        t.Skip("需要 POSTGRES_AUTH_TEST_DSN 指定独立认证测试库")
    }
    runDatabaseConcurrentInitialization(t, "postgres", dsn)
}

func runDatabaseConcurrentInitialization(t *testing.T, driver, dsn string) {
    db := testDB(t, driver, dsn)
    // 使用独立认证测试库，隔离其他 package 的并发建表。
    for _, model := range []any{&Session{}, &Account{}, &User{}} {
        if err := db.Where("1=1").Delete(model).Error; err != nil {
            t.Fatal(err)
        }
    }

    other := testDB(t, driver, dsn)
    first, _ := New(db, Config{Secret: secret, BootstrapToken: secret})
    second, _ := New(other, Config{Secret: secret, BootstrapToken: secret})
    concurrency(t, first, second)
    var user User
    db.Where("role = ?", "owner").First(&user)
    session, _, err := first.Login(context.Background(), user.Email, password, "127.0.0.1", "测试")
    if err != nil {
        t.Fatal(err)
    }
    if _, _, err = second.Resolve(context.Background(), session.Token); err != nil {
        t.Fatal(err)
    }
    if err = second.Logout(context.Background(), session.Token); err != nil {
        t.Fatal(err)
    }
    if _, _, err = first.Resolve(context.Background(), session.Token); !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }
}

func TestSessionLifecycleAndBan(t *testing.T) {
    s := testService(t)
    user := initialize(t, s)
    ctx := context.Background()
    for _, email := range []string{user.Email, "missing@example.com"} {
        if _, _, err := s.Login(ctx, email, "wrong", "", ""); !errors.Is(err, ErrCredentials) {
            t.Fatal(err)
        }
    }

    session, _, err := s.Login(ctx, user.Email, password, "127.0.0.1", "agent")
    if err != nil {
        t.Fatal(err)
    }

    old := time.Now().Add(-48 * time.Hour)
    s.db.Model(&Session{}).Where("id = ?", session.ID).Update("updated_at", old)
    refreshed, _, err := s.Resolve(ctx, session.Token)
    if err != nil || !refreshed.ExpiresAt.After(time.Now().Add(6*24*time.Hour)) {
        t.Fatal(err)
    }

    var persisted Session
    if err := s.db.First(&persisted, session.ID).Error; err != nil {
        t.Fatal(err)
    }
    if !refreshed.UpdatedAt.Equal(persisted.UpdatedAt) || !refreshed.ExpiresAt.Equal(persisted.ExpiresAt) {
        t.Fatal("续期返回值与数据库保持一致")
    }
    s.db.Model(&User{}).Where("id = ?", user.ID).Update("banned", true)
    if _, _, err = s.Resolve(ctx, session.Token); !errors.Is(err, ErrBanned) {
        t.Fatal(err)
    }
    if _, _, err = s.Login(ctx, user.Email, password, "", ""); !errors.Is(err, ErrBanned) {
        t.Fatal(err)
    }
    s.db.Model(&User{}).Where("id = ?", user.ID).Update("ban_expires", old)
    if _, _, err = s.Resolve(ctx, session.Token); err != nil {
        t.Fatal(err)
    }
    s.db.Model(&Session{}).Where("id = ?", session.ID).Update("expires_at", old)
    if _, _, err = s.Resolve(ctx, session.Token); !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }

    session, _, err = s.Login(ctx, user.Email, password, "", "")
    if err != nil {
        t.Fatal(err)
    }
    if err = s.Logout(ctx, session.Token); err != nil {
        t.Fatal(err)
    }
    if _, _, err = s.Resolve(ctx, session.Token); !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }
}

type testLimiter struct {
    fail bool
    deny bool
}

func (l testLimiter) Allow(context.Context, string, int) (bool, error) {
    if l.fail {
        return false, errors.New("Redis 私密地址")
    }
    return !l.deny, nil
}

func request(e *echo.Echo, method, path, body, token, origin string, cookie *http.Cookie) *httptest.ResponseRecorder {
    r := httptest.NewRequest(method, path, strings.NewReader(body))
    r.Header.Set("Content-Type", "application/json")
    if token != "" {
        r.Header.Set("Authorization", "Bearer "+token)
    }
    if origin != "" {
        r.Header.Set("Origin", origin)
    }
    if cookie != nil {
        r.AddCookie(cookie)
    }

    w := httptest.NewRecorder()
    e.ServeHTTP(w, r)
    return w
}

func TestHTTPAuthentication(t *testing.T) {
    s := testService(t)
    initialize(t, s)
    e := httpx.New()
    if err := s.Register(e, testLimiter{}); err != nil {
        t.Fatal(err)
    }
    e.GET("/api/graphql/admin", func(c *echo.Context) error { return c.String(200, "管理员") })
    e.GET("/api/websocket/bus-query", func(c *echo.Context) error { return c.String(200, "鉴权通过") })
    e.POST("/api/rest/demo/tasks", func(c *echo.Context) error { return c.String(200, "任务") })
    preflight := httptest.NewRequest("OPTIONS", "/api/rest/demo/session", nil)
    preflight.Header.Set("Origin", "http://localhost")
    preflight.Header.Set("Access-Control-Request-Method", "GET")
    preflight.Header.Set("Access-Control-Request-Headers", "Authorization")
    preflightResponse := httptest.NewRecorder()
    e.ServeHTTP(preflightResponse, preflight)
    if preflightResponse.Code != 204 || preflightResponse.Header().Get("Access-Control-Allow-Origin") != "http://localhost" || preflightResponse.Header().Get("Access-Control-Allow-Credentials") != "true" {
        t.Fatal(preflightResponse.Code, preflightResponse.Header())
    }
    if w := request(e, "GET", "/api/rest/demo/session", "", "", "", nil); w.Code != 401 {
        t.Fatal(w.Code, w.Body.String())
    }

    login := request(e, "POST", "/api/auth/sign-in/email", `{"email":"owner@example.com","password":"owner-password-2026"}`, "", "http://localhost", nil)
    if login.Code != 200 {
        t.Fatal(login.Code, login.Body.String())
    }

    cookie := login.Result().Cookies()[0]
    if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
        t.Fatal(cookie)
    }

    var result struct{ Token string }
    json.Unmarshal(login.Body.Bytes(), &result)
    for _, token := range []string{result.Token, s.Sign(result.Token)} {
        if w := request(e, "GET", "/api/rest/demo/session", "", token, "", nil); w.Code != 200 || !strings.Contains(w.Body.String(), "管理员") {
            t.Fatal(w.Code, w.Body.String())
        }
    }

    if w := request(e, "GET", "/api/auth/get-session", "", "", "", cookie); w.Code != 200 || strings.Contains(w.Body.String(), result.Token) {
        t.Fatal(w.Code, w.Body.String())
    }

    cookie.Value += "broken"
    if w := request(e, "GET", "/api/rest/demo/session", "", "", "", cookie); w.Code != 401 {
        t.Fatal(w.Code)
    }

    cookie.Value = login.Result().Cookies()[0].Value
    for _, origin := range []string{"", "https://evil.example"} {
        if w := request(e, "POST", "/api/rest/demo/tasks", "{}", "", origin, cookie); w.Code != 403 {
            t.Fatal(w.Code)
        }
    }

    if w := request(e, "GET", "/api/websocket/bus-query", "", result.Token, "https://evil.example", nil); w.Code != 403 {
        t.Fatal(w.Code)
    }
    s.db.Model(&User{}).Where("email = ?", "owner@example.com").Update("role", "member")
    if w := request(e, "GET", "/api/graphql/admin", "", result.Token, "", nil); w.Code != 403 {
        t.Fatal(w.Code)
    }
    if w := request(e, "GET", "/api/rest/demo/session", "", result.Token, "", nil); w.Code != 200 {
        t.Fatal(w.Code)
    }
    if w := request(e, "POST", "/api/auth/sign-out", "{}", "", "http://localhost", cookie); w.Code != 200 || w.Result().Cookies()[0].MaxAge != -1 {
        t.Fatal(w.Code)
    }
    if w := request(e, "GET", "/api/rest/demo/session", "", result.Token, "", nil); w.Code != 401 {
        t.Fatal(w.Code)
    }
    if w := request(e, "GET", "/api/auth/get-session", "", "", "", nil); w.Code != 200 || strings.TrimSpace(w.Body.String()) != "null" {
        t.Fatal(w.Code, w.Body.String())
    }

    s.config.Secure = true
    w := httptest.NewRecorder()
    ctx := e.NewContext(httptest.NewRequest("GET", "/", nil), w)
    s.cookie(ctx, &Session{Token: "safe", ExpiresAt: time.Now().Add(time.Hour)})
    if !w.Result().Cookies()[0].Secure {
        t.Fatal("Secure 缺失")
    }
}

func TestHTTPInputAndLimiter(t *testing.T) {
    s := testService(t)
    for _, item := range []struct {
        limiter testLimiter
        status  int
    }{{testLimiter{deny: true}, 429}, {testLimiter{fail: true}, 503}} {
        e := httpx.New()
        s.Register(e, item.limiter)
        w := request(e, "POST", "/api/auth/sign-in/email", `{"email":"owner@example.com","password":"secret"}`, "", "http://localhost", nil)
        if w.Code != item.status || strings.Contains(w.Body.String(), "私密") {
            t.Fatal(w.Code, w.Body.String())
        }
    }

    e := httpx.New()
    s.Register(e, testLimiter{})
    for _, body := range []string{"{", `{} {}`, strings.Repeat("x", 5000)} {
        if w := request(e, "POST", "/api/auth/sign-in/email", body, "", "http://localhost", nil); w.Code != 400 {
            t.Fatal(w.Code)
        }
    }

    if w := request(e, "POST", "/api/auth/sign-in/email", "{}", "", "https://evil.example", nil); w.Code != 403 {
        t.Fatal(w.Code)
    }
}

func TestRedisSharedLimiter(t *testing.T) {
    address := os.Getenv("REDIS_TEST_URL")
    if address == "" {
        t.Skip("需要隔离 Redis")
    }

    options, err := redis.ParseURL(address)
    if err != nil {
        t.Fatal(err)
    }

    client := redis.NewClient(options)
    defer client.Close()
    key := fmt.Sprint(time.Now().UnixNano())
    a := RedisLimiter{Client: client, Prefix: key}
    b := RedisLimiter{Client: client, Prefix: key}
    ctx := context.Background()
    if ok, err := a.Allow(ctx, "test", 1); !ok || err != nil {
        t.Fatal(ok, err)
    }
    if ok, err := b.Allow(ctx, "test", 1); ok || err != nil {
        t.Fatal(ok, err)
    }
    if ttl := client.TTL(ctx, key+":auth:limit:test").Val(); ttl <= 0 || ttl > time.Minute {
        t.Fatal(ttl)
    }
    client.Del(ctx, key+":auth:limit:test")
}

func TestPasswordConcurrencyBound(t *testing.T) {
    for i := 0; i < cap(passwordSlots); i++ {
        passwordSlots <- struct{}{}
    }

    defer func() {
        for i := 0; i < cap(passwordSlots); i++ {
            <-passwordSlots
        }
    }()
    if _, err := PasswordHash(password); !errors.Is(err, errPasswordBusy) {
        t.Fatal(err)
    }
}

func TestInitializationRollback(t *testing.T) {
    s := testService(t)
    ctx := context.Background()
    member := "member"
    user := User{Name: "已有成员", Email: "owner@example.com", Role: &member}
    if err := s.db.Create(&user).Error; err != nil {
        t.Fatal(err)
    }
    if _, err := s.Initialize(ctx, secret, "管理员", user.Email, password); err == nil {
        t.Fatal("重复邮箱通过")
    }

    var lock Bootstrap
    s.db.First(&lock, 1)
    if lock.Revision != 0 {
        t.Fatal("失败初始化留下锁状态")
    }
    if installed, err := s.Installed(ctx); err != nil || installed {
        t.Fatal(installed, err)
    }
    if _, err := s.Initialize(ctx, secret, "管理员", "new-owner@example.com", password); err != nil {
        t.Fatal(err)
    }
}

func TestApplicationHTTPConfiguration(t *testing.T) {
    s := testService(t)
    user := initialize(t, s)
    session, _, err := s.Login(context.Background(), user.Email, password, "", "")
    if err != nil {
        t.Fatal(err)
    }

    s.config.DashboardPath = "/api/rest/another/session"
    s.config.AdminPaths = []string{"/api/rest/another/manage"}
    s.config.DashboardPermissions = func(current *User) []string {
        if current.ID != user.ID {
            t.Fatal("应用权限回调获取当前身份")
        }
        return []string{"another:read"}
    }
    e := httpx.New()
    if err := s.Register(e, testLimiter{}); err != nil {
        t.Fatal(err)
    }
    e.GET("/api/rest/another/manage", func(c *echo.Context) error { return c.String(200, "管理操作") })
    if w := request(e, "GET", "/api/rest/another/session", "", session.Token, "", nil); w.Code != 200 || !strings.Contains(w.Body.String(), "another:read") {
        t.Fatal(w.Code, w.Body.String())
    }
    if w := request(e, "GET", "/api/rest/demo/session", "", session.Token, "", nil); w.Code != 404 {
        t.Fatal("Dashboard 路由由应用配置", w.Code)
    }
    if w := request(e, "GET", "/api/rest/another/manage", "", session.Token, "", nil); w.Code != 200 {
        t.Fatal(w.Code)
    }
    if err := s.db.Model(&User{}).Where("id = ?", user.ID).Update("role", "member").Error; err != nil {
        t.Fatal(err)
    }
    if w := request(e, "GET", "/api/rest/another/manage", "", session.Token, "", nil); w.Code != 403 {
        t.Fatal(w.Code)
    }
}

func TestHTTPInitializationPasswordRoundTrip(t *testing.T) {
    for _, item := range []struct {
        name     string
        password string
    }{
        {"ascii_minimum", "123456789012"},
        {"ascii_maximum", strings.Repeat("x", 128)},
        {"chinese_minimum", "初始化密"},
        {"nfkc", "迁移Ｐａｓｓｗｏｒｄ-2026"},
        {"spaces_and_symbols", "  owner-\"\\-密钥-2026  "},
    } {
        t.Run(item.name, func(t *testing.T) {
            s := testService(t)
            e := httpx.New()
            if err := s.Register(e, testLimiter{}); err != nil {
                t.Fatal(err)
            }

            payload, err := json.Marshal(map[string]string{
                "bootstrapToken": secret,
                "name":           "验收管理员",
                "email":          "OWNER@example.com",
                "password":       item.password,
            })
            if err != nil {
                t.Fatal(err)
            }

            response := request(e, "POST", "/api/auth/initialize", string(payload), "", "http://localhost", nil)
            if response.Code != 201 {
                t.Fatal(response.Code, response.Body.String())
            }

            status := request(e, "GET", "/api/auth/install-status", "", "", "", nil)
            var state struct {
                Installed bool
                Enabled   bool
            }
            if err := json.Unmarshal(status.Body.Bytes(), &state); err != nil || !state.Installed || state.Enabled {
                t.Fatal("初始化状态未更新", err)
            }

            var account Account
            if err := s.db.Where("provider_id = ?", "credential").Take(&account).Error; err != nil {
                t.Fatal(err)
            }
            if account.Password == nil || len(*account.Password) != 161 || !PasswordMatches(*account.Password, item.password) {
                t.Fatal("持久化密码校验失败")
            }
            // 新建服务模拟重启，验证登录使用持久化凭据。
            restarted, err := New(s.db, s.config)
            if err != nil {
                t.Fatal(err)
            }

            second := httpx.New()
            if err := restarted.Register(second, testLimiter{}); err != nil {
                t.Fatal(err)
            }

            login, err := json.Marshal(map[string]string{"email": "owner@example.com", "password": item.password})
            if err != nil {
                t.Fatal(err)
            }

            result := request(second, "POST", "/api/auth/sign-in/email", string(login), "", "http://localhost", nil)
            if result.Code != 200 || len(result.Result().Cookies()) != 1 {
                t.Fatal(result.Code, result.Body.String())
            }

            wrong, err := json.Marshal(map[string]string{"email": "owner@example.com", "password": "wrong-password"})
            if err != nil {
                t.Fatal(err)
            }
            if result := request(second, "POST", "/api/auth/sign-in/email", string(wrong), "", "http://localhost", nil); result.Code != 401 {
                t.Fatal("错误密码响应", result.Code)
            }
        })
    }
}
