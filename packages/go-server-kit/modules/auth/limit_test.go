package auth

// 本文件覆盖存在与未知邮箱的登录限流，以及数据库排序规则对账号限流键的影响。

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "os"
    "strings"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httpx"
    "github.com/redis/go-redis/v9"
)

type accountLimiter struct{ counts map[string]int }

func (l *accountLimiter) Allow(_ context.Context, key string, limit int) (bool, error) {
    l.counts[key]++
    return l.counts[key] <= limit, nil
}

func TestLoginLimitAccountAndUnknownEmail(t *testing.T) {
    s := testService(t)
    user := initialize(t, s)
    for _, email := range []string{user.Email, " OWNER@example.com "} {
        key, err := s.loginLimitKey(context.Background(), email)
        if err != nil || key != fmt.Sprint("account:", user.ID) {
            t.Fatal(key, err)
        }
    }

    for _, email := range []string{" MISSING@example.com ", "missing@example.com"} {
        key, err := s.loginLimitKey(context.Background(), email)
        if err != nil || key != "email:missing@example.com" {
            t.Fatal(key, err)
        }
    }

    e := httpx.New()
    limiter := &accountLimiter{counts: map[string]int{}}
    if err := s.Register(e, limiter); err != nil {
        t.Fatal(err)
    }

    for i := 0; i < 6; i++ {
        email := user.Email
        if i%2 == 1 {
            email = "OWNER@example.com"
        }

        response := request(e, "POST", "/api/auth/sign-in/email", fmt.Sprintf(`{"email":%q,"password":"wrong"}`, email), "", "http://localhost", nil)
        expected := http.StatusUnauthorized
        if i == 5 {
            expected = http.StatusTooManyRequests
        }
        if response.Code != expected {
            t.Fatal(response.Code, response.Body.String())
        }
    }
    // 未注册邮箱同样受邮箱桶保护，IP 桶与账号桶共同保留。
    for i := 0; i < 6; i++ {
        response := request(e, "POST", "/api/auth/sign-in/email", `{"email":"missing@example.com","password":"wrong"}`, "", "http://localhost", nil)
        expected := http.StatusUnauthorized
        if i == 5 {
            expected = http.StatusTooManyRequests
        }
        if response.Code != expected {
            t.Fatal(response.Code)
        }
    }

    for i := 0; i < 9; i++ {
        response := request(e, "POST", "/api/auth/sign-in/email", fmt.Sprintf(`{"email":"unique%d@example.com","password":"wrong"}`, i), "", "http://localhost", nil)
        expected := http.StatusUnauthorized
        if i == 8 {
            expected = http.StatusTooManyRequests
        }
        if response.Code != expected {
            t.Fatal("IP 桶", i, response.Code)
        }
    }
}

func TestMySQLLoginRateLimitCollation(t *testing.T) {
    dsn, redisURL := os.Getenv("MYSQL_AUTH_TEST_DSN"), os.Getenv("REDIS_TEST_URL")
    if dsn == "" || redisURL == "" {
        t.Skip("需要隔离认证测试库及 Redis")
    }
    runDatabaseLoginRateLimitCollation(t, "mysql", dsn)
}

func TestPostgreSQLLoginRateLimitCollation(t *testing.T) {
    dsn, redisURL := os.Getenv("POSTGRES_AUTH_TEST_DSN"), os.Getenv("REDIS_TEST_URL")
    if dsn == "" || redisURL == "" {
        t.Skip("需要隔离认证测试库及 Redis")
    }
    runDatabaseLoginRateLimitCollation(t, "postgres", dsn)
}

func runDatabaseLoginRateLimitCollation(t *testing.T, driver, dsn string) {
    redisURL := os.Getenv("REDIS_TEST_URL")
    db := testDB(t, driver, dsn)
    s, err := New(db, Config{Secret: secret, Origins: []string{"http://localhost"}})
    if err != nil {
        t.Fatal(err)
    }

    role := "owner"
    // 真实迁移保持大小写与重音不敏感的账号等价规则。
    email := fmt.Sprintf("review%d@example.test", time.Now().UnixNano())
    user := User{Name: "邮箱限流回归", Email: email, Role: &role}
    if err = db.Create(&user).Error; err != nil {
        t.Fatal(err)
    }

    hash, err := PasswordHash(password)
    if err != nil {
        t.Fatal(err)
    }
    if err = db.Create(&Account{
        AccountID:  fmt.Sprint(user.ID),
        ProviderID: "credential",
        UserID:     user.ID,
        Password:   &hash,
    }).Error; err != nil {
        t.Fatal(err)
    }

    alias := strings.Replace(email, "review", "réview", 1)
    _, got, err := s.Login(context.Background(), alias, password, "", "")
    if err != nil || got.ID != user.ID {
        t.Fatal("旧库重音邮箱匹配", err)
    }

    options, err := redis.ParseURL(redisURL)
    if err != nil {
        t.Fatal(err)
    }

    client := redis.NewClient(options)
    defer client.Close()
    e := httpx.New()
    if err = s.Register(e, RedisLimiter{Client: client, Prefix: fmt.Sprint("email-limit-", time.Now().UnixNano())}); err != nil {
        t.Fatal(err)
    }

    for i := 0; i < 7; i++ {
        variant := email
        if i == 6 {
            variant = alias
        }

        response := request(e, "POST", "/api/auth/sign-in/email", fmt.Sprintf(`{"email":%q,"password":%q}`, variant, password), "", "http://localhost", nil)
        expected := http.StatusOK
        if i >= 5 {
            expected = http.StatusTooManyRequests
        }
        if response.Code != expected {
            t.Fatal(i, response.Code, response.Body.String())
        }
        if i < 5 {
            var body struct {
                User struct {
                    ID string `json:"id"`
                } `json:"user"`
            }
            if err = json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.User.ID != fmt.Sprint(user.ID) {
                t.Fatal(body, err)
            }
        }
    }
}
