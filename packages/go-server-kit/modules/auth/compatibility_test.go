package auth

// 本文件覆盖旧多字节密码、逗号组合角色及登录密码长度上限，分别验证 SQLite 与外部数据库。

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "os"
    "strings"
    "testing"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httpx"
    "github.com/labstack/echo/v5"
)

func legacyMultibytePasswords(t *testing.T, s *Service) {
    t.Helper()
    raw, err := os.ReadFile("fixtures/legacy-multibyte-passwords.json")
    if err != nil {
        t.Fatal(err)
    }

    var fixture struct {
        Cases []struct {
            Name, Password, Hash string
            JSLength, UTF8Bytes  int
            NodeMatches          bool
        }
    }
    if err := json.Unmarshal(raw, &fixture); err != nil || len(fixture.Cases) != 3 {
        t.Fatal("旧多字节样本无效", err)
    }

    e := httpx.New()
    if err := s.Register(e, testLimiter{}); err != nil {
        t.Fatal(err)
    }

    for index, sample := range fixture.Cases {
        t.Run(sample.Name, func(t *testing.T) {
            if !sample.NodeMatches || sample.JSLength > 128 || sample.UTF8Bytes != len(sample.Password) || sample.UTF8Bytes <= 128 {
                t.Fatal("旧样本长度或参考验证无效")
            }
            if !PasswordMatches(sample.Hash, sample.Password) {
                t.Fatal("旧多字节密码验证失败")
            }
            if _, err := PasswordHash(sample.Password); err == nil {
                t.Fatal("新密码应遵守 128 字节上限")
            }

            role := "owner,user"
            user := User{
                Name:  "旧多字节账号",
                Email: fmt.Sprintf("legacy-multibyte-%d@example.com", index),
                Role:  &role,
            }
            if err := s.db.Create(&user).Error; err != nil {
                t.Fatal(err)
            }
            if err := s.db.Create(&Account{
                AccountID:  fmt.Sprint(user.ID),
                ProviderID: "credential",
                UserID:     user.ID,
                Password:   &sample.Hash,
            }).Error; err != nil {
                t.Fatal(err)
            }
            if _, got, err := s.Login(context.Background(), user.Email, sample.Password, "", ""); err != nil || got.ID != user.ID {
                t.Fatal("旧多字节账号登录失败", err)
            }

            body, _ := json.Marshal(map[string]string{"email": user.Email, "password": sample.Password})
            w := request(e, "POST", "/api/auth/sign-in/email", string(body), "", "http://localhost", nil)
            if w.Code != 200 {
                t.Fatal(w.Code, w.Body.String())
            }

            body, _ = json.Marshal(map[string]string{
                "name":           "新管理员",
                "email":          "new@example.com",
                "password":       sample.Password,
                "bootstrapToken": secret,
            })
            if w := request(e, "POST", "/api/auth/initialize", string(body), "", "http://localhost", nil); w.Code != 400 {
                t.Fatal("新密码 HTTP 上限失效", w.Code, w.Body.String())
            }
        })
    }
}

func combinedRoles(t *testing.T, s *Service) {
    t.Helper()
    ctx := context.Background()
    user := initialize(t, s)
    session, _, err := s.Login(ctx, user.Email, password, "", "")
    if err != nil {
        t.Fatal(err)
    }

    e := httpx.New()
    e.GET("/api/graphql/admin", func(c *echo.Context) error { return c.NoContent(200) })
    if err := s.Register(e, testLimiter{}); err != nil {
        t.Fatal(err)
    }

    cases := []struct {
        role  string
        admin bool
    }{
        {"owner", true}, {"admin", true}, {"owner,user", true}, {"user,admin", true},
        {"user,owner,member", true}, {"member,admin,user", true}, {"admin,admin", true},
        {"", false}, {"member,user", false}, {"superadmin", false}, {"owner-admin", false},
        {"user,admin-extra", false}, {"OWNER,user", false}, {"user,ADMIN", false},
    }
    for _, sample := range cases {
        t.Run(sample.role, func(t *testing.T) {
            if err := s.db.Model(&User{}).Where("id = ?", user.ID).Update("role", sample.role).Error; err != nil {
                t.Fatal(err)
            }

            user.Role = &sample.role
            if got := HasRole(user, "owner", "admin"); got != sample.admin {
                t.Fatal("角色成员判断", got, sample.admin)
            }
            if got, err := s.Installed(ctx); err != nil || got != sample.admin {
                t.Fatal("安装状态", got, sample.admin, err)
            }

            expected := 403
            if sample.admin {
                expected = 200
                if _, err := s.Initialize(ctx, secret, "重复管理员", "another@example.com", password); !errors.Is(err, ErrInstalled) {
                    t.Fatal("已有组合管理员时的重复初始化", err)
                }
            }
            if w := request(e, "GET", "/api/graphql/admin", "", session.Token, "", nil); w.Code != expected {
                t.Fatal("后台权限", w.Code, w.Body.String())
            }
        })
    }

    if err := s.db.Model(&User{}).Where("id = ?", user.ID).Update("role", nil).Error; err != nil {
        t.Fatal(err)
    }
    if got, err := s.Installed(ctx); err != nil || got {
        t.Fatal("空角色安装状态", got, err)
    }
    if HasRole(nil, "owner") || HasRole(&User{}, "admin") || HasRole(user, "") {
        t.Fatal("空角色授予权限")
    }
}

func TestLegacyMultibytePasswordsSQLite(t *testing.T) { legacyMultibytePasswords(t, testService(t)) }

func TestCombinedRolesSQLite(t *testing.T) { combinedRoles(t, testService(t)) }

func TestLegacyPasswordAndRolesMySQL(t *testing.T) {
    dsn := os.Getenv("MYSQL_AUTH_TEST_DSN")
    if dsn == "" {
        t.Skip("需要 MYSQL_AUTH_TEST_DSN 指定独立认证测试库")
    }
    runDatabaseLegacyPasswordAndRoles(t, "mysql", dsn)
}

func TestLegacyPasswordAndRolesPostgreSQL(t *testing.T) {
    dsn := os.Getenv("POSTGRES_AUTH_TEST_DSN")
    if dsn == "" {
        t.Skip("需要 POSTGRES_AUTH_TEST_DSN 指定独立认证测试库")
    }
    runDatabaseLegacyPasswordAndRoles(t, "postgres", dsn)
}

func runDatabaseLegacyPasswordAndRoles(t *testing.T, driver, dsn string) {
    s, err := New(testDB(t, driver, dsn), Config{
        Secret:         secret,
        BootstrapToken: secret,
        Origins:        []string{"http://localhost"},
        AdminPaths:     []string{"/api/graphql/admin"},
    })
    if err != nil {
        t.Fatal(err)
    }
    // 与原 MySQL 并发初始化用例共享专用认证库，按外键顺序重置本用例状态。
    for _, model := range []any{&Session{}, &Account{}, &User{}} {
        if err := s.db.Where("1=1").Delete(model).Error; err != nil {
            t.Fatal(err)
        }
    }

    combinedRoles(t, s)
    legacyMultibytePasswords(t, s)
}

func TestLoginPasswordLengthBound(t *testing.T) {
    s := testService(t)
    e := httpx.New()
    if err := s.Register(e, testLimiter{}); err != nil {
        t.Fatal(err)
    }

    for _, length := range []int{maxLoginPasswordBytes, maxLoginPasswordBytes + 1} {
        value := strings.Repeat("x", length)
        body, _ := json.Marshal(map[string]string{"email": "missing@example.com", "password": value})
        w := request(e, "POST", "/api/auth/sign-in/email", string(body), "", "http://localhost", nil)
        expected := 401
        if length > maxLoginPasswordBytes {
            expected = 400
            if PasswordMatches(s.dummy, value) {
                t.Fatal("超长输入通过密码校验")
            }
        }
        if w.Code != expected {
            t.Fatal(length, w.Code, w.Body.String())
        }
    }
}
