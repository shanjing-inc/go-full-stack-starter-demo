package auth

// 本文件覆盖权限矩阵、各方言用户筛选与查询审计，以及后台权限别名。

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httpx"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/requestmeta"
    "context"
    "errors"
    "github.com/labstack/echo/v5"
    "net/http"
    "os"
    "reflect"
    "slices"
    "strings"
    "testing"
    "time"
)

func pointer[T any](value T) *T { return &value }

func userContext(role string) context.Context {
    return WithUser(context.Background(), &User{ID: 1, Role: &role})
}

func assertUserError(t *testing.T, err error, code string) {
    t.Helper()
    var e *httperr.Error
    if !errors.As(err, &e) || e.Code != code {
        t.Fatalf("期望 %s，得到 %v", code, err)
    }
}

func TestPermissionMatrix(t *testing.T) {
    s := testService(t)
    for _, item := range []struct {
        role               string
        admin, list, owner bool
    }{
        {"owner", true, true, true}, {"admin", true, true, false}, {"member", false, false, false}, {"user", false, false, false},
        {"member,admin", true, true, false}, {"admin,owner", true, true, true}, {"administrator", false, false, false},
        {"Admin", false, false, false}, {"unknown", false, false, false}, {"", false, false, false},
    } {
        t.Run(item.role, func(t *testing.T) {
            user := &User{ID: 1, Role: &item.role}
            if s.Allows(user, "dashboard", "access:admin") != item.admin || s.Allows(user, "user", "list") != item.list || s.Allows(user, "shop", "create") != item.admin || s.Allows(user, "system", "owner") != item.owner {
                t.Fatal("权限矩阵不一致")
            }

            permissions := s.Permissions(user)
            if !slices.IsSorted(permissions) {
                t.Fatal("权限需要稳定排序")
            }
            if slices.Contains(permissions, "user:list") != item.list {
                t.Fatal("会话与权限门禁不一致")
            }
            if item.list {
                if err := s.Require(WithUser(context.Background(), user), "user", "list"); err != nil {
                    t.Fatal(err)
                }
            } else {
                assertUserError(t, s.Require(WithUser(context.Background(), user), "user", "list"), "FORBIDDEN")
            }
        })
    }

    for _, user := range []*User{nil, {}, {ID: 1}, {ID: 0, Role: pointer("owner")}} {
        if s.Allows(user, "user", "list") || len(s.Permissions(user)) > 0 {
            t.Fatal("无效身份获得权限")
        }
    }

    config := RolePermissions{"reader": {{"dashboard", "access:admin"}, {"user", "list"}}}
    custom, err := New(s.db, Config{Secret: secret, Permissions: config})
    if err != nil {
        t.Fatal(err)
    }

    config["reader"][1] = Permission{"user", "delete"}
    delete(config, "reader")
    user := &User{ID: 1, Role: pointer("reader")}
    if !custom.Allows(user, "user", "list") || custom.Allows(user, "user", "delete") {
        t.Fatal("配置深复制失败")
    }

    deny, err := New(s.db, Config{Secret: secret, Permissions: RolePermissions{}})
    if err != nil {
        t.Fatal(err)
    }
    if deny.Allows(&User{ID: 1, Role: pointer("owner")}, "user", "list") {
        t.Fatal("空策略需要 deny-all")
    }
}

func runUserQueries(t *testing.T, s *Service) {
    t.Helper()
    ctx := userContext("admin")
    fixed := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
    fixtures := []User{
        {
            ID:        1,
            Name:      "甲",
            Email:     "alpha@example.test",
            Role:      pointer("owner"),
            Banned:    pointer(false),
            CreatedAt: fixed,
            UpdatedAt: fixed,
        },
        {
            ID:            2,
            Name:          "乙",
            Email:         "beta@example.test",
            Role:          pointer("admin"),
            Banned:        pointer(true),
            EmailVerified: true,
            CreatedAt:     fixed,
            UpdatedAt:     fixed,
        },
        {
            ID:        3,
            Name:      "丙",
            Email:     "gamma@other.test",
            Role:      pointer("member,admin"),
            Banned:    pointer(false),
            CreatedAt: fixed,
            UpdatedAt: fixed,
        },
        {
            ID:        4,
            Name:      "丁",
            Email:     "delta@other.test",
            Role:      nil,
            Banned:    pointer(false),
            CreatedAt: fixed,
            UpdatedAt: fixed,
        },
    }
    if err := s.db.Create(&fixtures).Error; err != nil {
        t.Fatal(err)
    }
    if err := s.db.Model(&User{}).Where("id = ?", 4).Update("banned", nil).Error; err != nil {
        t.Fatal(err)
    }

    tests := []struct {
        name  string
        where UserFilters
        ids   []int
    }{
        {"默认稳定分页", UserFilters{}, []int{4, 3, 2, 1}},
        {
            "整数比较",
            UserFilters{ID: &IntCondition{
                Gt:  pointer(1),
                Gte: pointer(2),
                Lt:  pointer(4),
                Lte: pointer(3),
                Ne:  pointer(2),
            }},
            []int{3},
        },
        {
            "整数等于",
            UserFilters{ID: &IntCondition{Eq: pointer(2)}},
            []int{2},
        },
        {
            "整数数组",
            UserFilters{ID: &IntCondition{InArray: []int{1, 2, 3}, NotInArray: []int{2}}},
            []int{3, 1},
        },
        {
            "空整数数组",
            UserFilters{ID: &IntCondition{InArray: []int{}}},
            []int{},
        },
        {
            "空排除数组",
            UserFilters{ID: &IntCondition{NotInArray: []int{}}},
            []int{4, 3, 2, 1},
        },
        {
            "整数非空",
            UserFilters{ID: &IntCondition{IsNotNull: pointer(true), IsNull: pointer(false)}},
            []int{4, 3, 2, 1},
        },
        {
            "整数空值",
            UserFilters{ID: &IntCondition{IsNull: pointer(true)}},
            []int{},
        },
        {
            "邮箱LIKE",
            UserFilters{Email: &StringCondition{Like: pointer("%@example.test")}},
            []int{2, 1},
        },
        {
            "邮箱NOT LIKE",
            UserFilters{Email: &StringCondition{NotLike: pointer("%@example.test")}},
            []int{4, 3},
        },
        {
            "邮箱ILIKE",
            UserFilters{Email: &StringCondition{Ilike: pointer("ALPHA@EXAMPLE.TEST")}},
            []int{1},
        },
        {
            "邮箱NOT ILIKE",
            UserFilters{Email: &StringCondition{NotIlike: pointer("%@OTHER.TEST")}},
            []int{2, 1},
        },
        {
            "字符串比较",
            UserFilters{Email: &StringCondition{
                Gt:  pointer("alpha"),
                Gte: pointer("beta"),
                Lt:  pointer("gamma"),
                Lte: pointer("delta@other.test"),
                Ne:  pointer("beta@example.test"),
            }},
            []int{4},
        },
        {
            "字符串数组",
            UserFilters{Role: &StringCondition{InArray: []string{"owner", "admin"}, NotInArray: []string{"owner"}}},
            []int{2},
        },
        {
            "空字符串数组",
            UserFilters{Email: &StringCondition{InArray: []string{}}},
            []int{},
        },
        {
            "空字符串排除",
            UserFilters{Email: &StringCondition{NotInArray: []string{}}},
            []int{4, 3, 2, 1},
        },
        {
            "角色精确",
            UserFilters{Role: &StringCondition{Eq: pointer("admin")}},
            []int{2},
        },
        {
            "角色空值",
            UserFilters{Role: &StringCondition{IsNull: pointer(true)}},
            []int{4},
        },
        {
            "角色非空",
            UserFilters{Role: &StringCondition{IsNotNull: pointer(true)}},
            []int{3, 2, 1},
        },
        {
            "非空取反",
            UserFilters{Role: &StringCondition{IsNotNull: pointer(false)}},
            []int{4},
        },
        {
            "空值取反",
            UserFilters{Role: &StringCondition{IsNull: pointer(false)}},
            []int{3, 2, 1},
        },
        {"封禁", UserFilters{Banned: pointer(true)}, []int{2}},
        {
            "正常精确布尔",
            UserFilters{Banned: pointer(false)},
            []int{3, 1},
        },
        {
            "邮箱已验证",
            UserFilters{EmailVerified: pointer(true)},
            []int{2},
        },
        {
            "邮箱待验证",
            UserFilters{EmailVerified: pointer(false)},
            []int{4, 3, 1},
        },
        {
            "参数化SQL",
            UserFilters{Email: &StringCondition{Eq: pointer("' OR 1=1 --")}},
            []int{},
        },
    }
    for _, item := range tests {
        t.Run(item.name, func(t *testing.T) {
            rows, err := s.ListUsers(ctx, UserListQuery{Limit: 20, Where: item.where})
            if err != nil {
                t.Fatal(err)
            }

            ids := []int{}
            for _, row := range rows {
                ids = append(ids, row.ID)
            }

            if !reflect.DeepEqual(ids, item.ids) {
                t.Fatalf("得到 %v，期望 %v", ids, item.ids)
            }
        })
    }

    rows, err := s.ListUsers(ctx, UserListQuery{Limit: 2, Offset: 1, Order: []UserOrder{{Field: "id"}}})
    if err != nil || len(rows) != 2 || rows[0].ID != 2 || rows[1].ID != 3 {
        t.Fatalf("分页排序错误：%v %v", rows, err)
    }

    rows, err = s.ListUsers(ctx, UserListQuery{Limit: 0})
    if err != nil || rows == nil || len(rows) != 0 {
        t.Fatal("limit0需要空数组", err)
    }

    for _, item := range []UserListQuery{
        {Limit: -1}, {Limit: 102}, {Limit: 1, Offset: -1}, {Limit: 1, Order: []UserOrder{{Field: "email; DROP TABLE user"}}},
        {Limit: 1, Order: []UserOrder{{Field: "id"}, {Field: "id"}}},
        {Limit: 1, Where: UserFilters{Email: &StringCondition{Like: pointer(strings.Repeat("x", 513))}}},
        {Limit: 1, Where: UserFilters{Email: &StringCondition{InArray: make([]string, 101)}}},
        {Limit: 1, Where: UserFilters{ID: &IntCondition{InArray: make([]int, 101)}}},
        {Limit: 1, Where: UserFilters{Email: &StringCondition{NotInArray: []string{strings.Repeat("x", 513)}}}},
    } {
        _, err := s.ListUsers(ctx, item)
        assertUserError(t, err, "BAD_USER_INPUT")
    }

    for _, role := range []string{"user", "member", "unknown"} {
        _, err := s.ListUsers(userContext(role), UserListQuery{Limit: 1})
        assertUserError(t, err, "FORBIDDEN")
    }

    _, err = s.GetUser(ctx, UserFilters{})
    assertUserError(t, err, "BAD_USER_INPUT")
    _, err = s.GetUser(ctx, UserFilters{Email: &StringCondition{}})
    assertUserError(t, err, "BAD_USER_INPUT")
    row, err := s.GetUser(ctx, UserFilters{ID: &IntCondition{Eq: pointer(2)}})
    if err != nil || row == nil || row.ID != 2 {
        t.Fatal("单项用户读取失败", err)
    }

    row, err = s.GetUser(ctx, UserFilters{ID: &IntCondition{Eq: pointer(999)}})
    if err != nil || row != nil {
        t.Fatal("空结果读取失败", err)
    }

    row, err = s.CurrentUser(userContext("user"))
    if err != nil || row == nil || row.ID != 1 {
        t.Fatal("当前用户读取失败", err)
    }

    _, err = s.CurrentUser(context.Background())
    assertUserError(t, err, "FORBIDDEN")
    _, err = s.GetUser(userContext("user"), UserFilters{ID: &IntCondition{Eq: pointer(1)}})
    assertUserError(t, err, "FORBIDDEN")
    canceled, cancel := context.WithCancel(ctx)
    cancel()
    _, err = s.ListUsers(canceled, UserListQuery{Limit: 1})
    if !errors.Is(err, context.Canceled) {
        t.Fatal("查询取消未传播", err)
    }
}

func TestUserQueriesSQLite(t *testing.T) { runUserQueries(t, testService(t)) }

func TestUserQueriesMySQL(t *testing.T) {
    dsn := os.Getenv("MYSQL_AUTH_TEST_DSN")
    if dsn == "" {
        t.Skip("需要独立 MYSQL_AUTH_TEST_DSN")
    }
    runDatabaseUserQueries(t, "mysql", dsn)
}

func TestUserQueriesPostgreSQL(t *testing.T) {
    dsn := os.Getenv("POSTGRES_AUTH_TEST_DSN")
    if dsn == "" {
        t.Skip("需要独立 POSTGRES_AUTH_TEST_DSN")
    }
    runDatabaseUserQueries(t, "postgres", dsn)
}

func runDatabaseUserQueries(t *testing.T, driver, dsn string) {
    db := testDB(t, driver, dsn)
    for _, model := range []any{&Session{}, &Account{}, &User{}} {
        if err := db.Where("1=1").Delete(model).Error; err != nil {
            t.Fatal(err)
        }
    }

    s, err := New(db, Config{Secret: secret})
    if err != nil {
        t.Fatal(err)
    }
    runUserQueries(t, s)
}

func TestUserAudit(t *testing.T) {
    s := testService(t)
    var events []AuditEvent
    s.config.Audit = func(_ context.Context, e AuditEvent) { events = append(events, e) }
    ctx := requestmeta.WithRequestMeta(userContext("admin"), requestmeta.RequestMeta{RequestID: "r2-request"})
    _, err := s.GetUser(ctx, UserFilters{ID: &IntCondition{Eq: pointer(987)}})
    if err != nil {
        t.Fatal(err)
    }

    _, err = s.ListUsers(userContext("user"), UserListQuery{Limit: 1})
    assertUserError(t, err, "FORBIDDEN")
    _, err = s.ListUsers(ctx, UserListQuery{Limit: -1, Where: UserFilters{Email: &StringCondition{Eq: pointer("secret@example.test")}}})
    assertUserError(t, err, "BAD_USER_INPUT")
    if len(events) != 3 || events[0].Result != "success" || events[0].ActorID != "1" || events[0].Target != "987" || events[0].RequestID != "r2-request" || events[0].Time.IsZero() || events[1].Result != "denied" || events[2].Result != "failed" {
        t.Fatalf("审计关联失败：%+v", events)
    }
}

func TestGuardResourcePermissions(t *testing.T) {
    base := testService(t)
    policies := RolePermissions{"reader": {{"dashboard", "access:admin"}, {"user", "list"}}, "blocked": {{"dashboard", "access:admin"}}}
    paths := map[string]Permission{
        "/api/rest/users/:id": {"user", "list"},
        "/api/graphql/admin":  {"user", "list"},
        "/api/sse/stream":     {"user", "list"},
        "/api/ws/stream":      {"user", "list"},
    }
    s, err := New(base.db, Config{
        Secret:          secret,
        Origins:         []string{"http://localhost"},
        Permissions:     policies,
        PathPermissions: paths,
        DashboardPath:   "/api/rest/session",
        AdminPaths:      []string{"/api/graphql/admin"},
    })
    if err != nil {
        t.Fatal(err)
    }
    // 工程配置复制后，原始 map 修改保持隔离。
    paths["/api/graphql/admin"] = Permission{"user", "delete"}
    e := httpx.New()
    if err := s.Register(e, testLimiter{}); err != nil {
        t.Fatal(err)
    }

    for _, path := range []string{
        "/api/rest/users/:id",
        "/api/graphql/admin",
        "/api/sse/stream",
        "/api/ws/stream",
    } {
        e.GET(path, func(c *echo.Context) error { return c.NoContent(204) })
    }

    for i, role := range []string{"reader", "blocked"} {
        user := User{
            ID:    i + 1,
            Name:  role,
            Email: role + "@example.test",
            Role:  &role,
        }
        if err := s.db.Create(&user).Error; err != nil {
            t.Fatal(err)
        }

        session := Session{
            UserID:    user.ID,
            Token:     role + "-token",
            ExpiresAt: time.Now().Add(time.Hour),
        }
        if err := s.db.Create(&session).Error; err != nil {
            t.Fatal(err)
        }

        for _, path := range []string{
            "/api/rest/users/1",
            "/api/graphql/admin",
            "/api/sse/stream",
            "/api/ws/stream",
        } {
            got := request(e, http.MethodGet, path, "", session.Token, "", nil)
            expected := 204
            if role == "blocked" {
                expected = 403
            }
            if got.Code != expected {
                t.Fatalf("%s %s：%d %s", role, path, got.Code, got.Body.String())
            }
        }

        got := request(e, http.MethodGet, "/api/rest/session", "", session.Token, "", nil)
        if got.Code != 200 || strings.Contains(got.Body.String(), "user:list") != (role == "reader") {
            t.Fatal("会话权限输出不一致", got.Body.String())
        }
    }
    // 正式路由同时经过认证门禁，匿名调用在身份解析阶段拒绝。
    if got := request(e, http.MethodGet, "/api/rest/users/1", "", "", "", nil); got.Code != 401 {
        t.Fatal(got.Code)
    }
}

func TestDashboardPermissionAliases(t *testing.T) {
    s := testService(t)
    s.config.DashboardPermissions = func(*User) []string { return []string{"demo:read", "demo:read", "user:list"} }
    user := &User{ID: 1, Role: pointer("member,admin")}
    got := s.DashboardPermissions(user)
    if !slices.IsSorted(got) || len(got) != len(s.Permissions(user))+1 || !slices.Contains(got, "demo:read") {
        t.Fatal(got)
    }
    if len(s.DashboardPermissions(nil)) != 0 || len(s.DashboardPermissions(&User{})) != 0 {
        t.Fatal("空身份应返回空权限")
    }
}
