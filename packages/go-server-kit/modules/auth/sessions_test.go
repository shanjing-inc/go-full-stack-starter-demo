package auth

// 本文件覆盖会话安全投影、分页、最新操作人权限、单会话撤销隔离和审计，以及 SQLite 绝对时间排序。

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "os"
    "strings"
    "testing"
    "time"
)

func sessionFixture(t *testing.T, s *Service, user *User, token string, expires time.Time) Session {
    t.Helper()
    row := Session{
        UserID:    user.ID,
        Token:     token,
        ExpiresAt: expires,
        IPAddress: pointer("127.0.0.1"),
        UserAgent: pointer("测试浏览器"),
        CreatedAt: time.Now().UTC().Truncate(time.Hour),
    }
    if err := s.db.Create(&row).Error; err != nil {
        t.Fatal(err)
    }
    return row
}

func TestUserSessionListProjectionPagination(t *testing.T) {
    s := testService(t)
    ctx, admin, member := mutationFixture(t, s)
    first := sessionFixture(t, s, member, "private-first-token", time.Now().Add(time.Hour))
    second := sessionFixture(t, s, member, "private-second-token", time.Now().Add(time.Hour))
    sessionFixture(t, s, member, "private-expired-token", time.Now().Add(-time.Second))
    sessionFixture(t, s, admin, "private-other-token", time.Now().Add(time.Hour))
    ctx = context.WithValue(ctx, sessionIDKey{}, second.ID)
    var events []AuditEvent
    s.config.Audit = func(_ context.Context, e AuditEvent) { events = append(events, e) }
    rows, err := s.ListUserSessions(ctx, member.ID, 1, 0)
    if err != nil || len(rows) != 1 || rows[0].ID != second.ID || !rows[0].Current || *rows[0].IPAddress != "127.0.0.1" {
        t.Fatal(rows, err)
    }

    rows, err = s.ListUserSessions(ctx, member.ID, 1, 1)
    if err != nil || len(rows) != 1 || rows[0].ID != first.ID || rows[0].Current {
        t.Fatal(rows, err)
    }

    rows, err = s.ListUserSessions(ctx, member.ID, 0, 0)
    if err != nil || len(rows) != 2 {
        t.Fatal(rows, err)
    }

    raw, _ := json.Marshal(rows)
    if strings.Contains(strings.ToLower(string(raw)), "token") {
        t.Fatal("投影包含认证令牌")
    }

    rows, err = s.ListUserSessions(ctx, member.ID, 20, 2)
    if err != nil || rows == nil || len(rows) != 0 {
        t.Fatal(rows, err)
    }

    for _, args := range [][3]int{
        {0, 20, 0},
        {2147483648, 20, 0},
        {member.ID, -1, 0},
        {member.ID, 102, 0},
        {member.ID, 20, -1},
        {member.ID, 20, 1000001},
        {99999, 20, 0},
    } {
        _, err = s.ListUserSessions(ctx, args[0], args[1], args[2])
        assertUserError(t, err, "BAD_USER_INPUT")
    }

    if len(events) != 11 || events[0].Action != "list" || events[0].Target != fmt.Sprint(member.ID) {
        t.Fatal(events)
    }

    for _, event := range events {
        if strings.Contains(fmt.Sprint(event), "private-") {
            t.Fatal("审计包含令牌")
        }
    }
}

func TestUserSessionManagementPermissionsAndFreshActor(t *testing.T) {
    s := testService(t)
    ctx, admin, member := mutationFixture(t, s)
    owner, _ := UserFrom(ctx)
    row := sessionFixture(t, s, owner, "owner-session", time.Now().Add(time.Hour))
    adminCtx := WithUser(context.Background(), admin)
    for _, denied := range []context.Context{
        context.Background(),
        WithUser(context.Background(), member),
        adminCtx,
    } {
        _, err := s.ListUserSessions(denied, owner.ID, 20, 0)
        assertUserError(t, err, "FORBIDDEN")
        assertUserError(t, s.RevokeUserSession(denied, owner.ID, row.ID), "FORBIDDEN")
    }
    // 单独保留 list 权限的读取账号可查看低权限用户，撤销仍要求 revoke。
    s.permissions["viewer"] = []Permission{{"session", "list"}}
    if err := s.db.Model(admin).Update("role", "viewer").Error; err != nil {
        t.Fatal(err)
    }

    target, err := s.CreateUser(ctx, CreateUserInput{Name: "用户", Email: "low@example.test", Password: password})
    if err != nil {
        t.Fatal(err)
    }

    viewer := *admin
    viewer.Role = pointer("viewer")
    _, err = s.ListUserSessions(WithUser(context.Background(), &viewer), target.ID, 20, 0)
    if err != nil {
        t.Fatal(err)
    }
    assertUserError(t, s.RevokeUserSession(WithUser(context.Background(), &viewer), target.ID, row.ID), "FORBIDDEN")
    // 管理写入与列表均重新读取数据库中的权限和封禁状态。
    assertUserError(t, s.RevokeUserSession(adminCtx, member.ID, row.ID), "FORBIDDEN")
    if err = s.db.Model(admin).Update("role", "user").Error; err != nil {
        t.Fatal(err)
    }

    _, err = s.ListUserSessions(adminCtx, target.ID, 20, 0)
    assertUserError(t, err, "FORBIDDEN")
    if err = s.db.Model(admin).Updates(map[string]any{"role": "admin", "banned": true}).Error; err != nil {
        t.Fatal(err)
    }

    _, err = s.ListUserSessions(adminCtx, target.ID, 20, 0)
    assertUserError(t, err, "FORBIDDEN")
    assertUserError(t, s.RevokeUserSession(adminCtx, member.ID, row.ID), "FORBIDDEN")
}

func TestSingleSessionRevocationIsolationAndAudit(t *testing.T) {
    s := testService(t)
    ctx, admin, member := mutationFixture(t, s)
    first := sessionFixture(t, s, member, "member-first", time.Now().Add(time.Hour))
    second := sessionFixture(t, s, member, "member-second", time.Now().Add(time.Hour))
    other := sessionFixture(t, s, admin, "admin-other", time.Now().Add(time.Hour))
    connection := s.connectionContext(context.Background(), first.Token, member)
    var events []AuditEvent
    s.config.Audit = func(_ context.Context, e AuditEvent) { events = append(events, e) }
    for range 2 {
        if err := s.RevokeUserSession(ctx, member.ID, first.ID); err != nil {
            t.Fatal(err)
        }
    }

    if _, _, err := s.Resolve(ctx, first.Token); !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }
    if err := ValidateConnection(connection); !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }
    // 即使传入其他用户的会话 ID，删除范围仍限定为目标用户。
    if err := s.RevokeUserSession(ctx, member.ID, other.ID); err != nil {
        t.Fatal(err)
    }

    for _, token := range []string{second.Token, other.Token} {
        if _, _, err := s.Resolve(ctx, token); err != nil {
            t.Fatal(err)
        }
    }

    for _, ids := range [][2]int{
        {0, first.ID},
        {member.ID, 0},
        {member.ID, -1},
        {member.ID, 2147483648},
        {999999, first.ID},
    } {
        assertUserError(t, s.RevokeUserSession(ctx, ids[0], ids[1]), "BAD_USER_INPUT")
    }

    if len(events) != 8 || events[0].Action != "revoke-one" || events[0].Target != fmt.Sprintf("%d/%d", member.ID, first.ID) {
        t.Fatal(events)
    }
}

// 正式验收提供独立 MySQL 库，验证 SQL 分页及跨 Service 实例会话撤销。
func TestMySQLSessionManagement(t *testing.T) {
    dsn := os.Getenv("MYSQL_AUTH_TEST_DSN")
    if dsn == "" {
        t.Skip("需要独立 MYSQL_AUTH_TEST_DSN")
    }
    runDatabaseSessionManagement(t, "mysql", dsn)
}

func TestPostgreSQLSessionManagement(t *testing.T) {
    dsn := os.Getenv("POSTGRES_AUTH_TEST_DSN")
    if dsn == "" {
        t.Skip("需要独立 POSTGRES_AUTH_TEST_DSN")
    }
    runDatabaseSessionManagement(t, "postgres", dsn)
}

func runDatabaseSessionManagement(t *testing.T, driver, dsn string) {
    db := testDB(t, driver, dsn)
    for _, model := range []any{&Session{}, &Account{}, &User{}} {
        if err := db.Where("1=1").Delete(model).Error; err != nil {
            t.Fatal(err)
        }
    }

    first, err := New(db, Config{Secret: secret, BootstrapToken: secret})
    if err != nil {
        t.Fatal(err)
    }

    second, err := New(testDB(t, driver, dsn), Config{Secret: secret, BootstrapToken: secret})
    if err != nil {
        t.Fatal(err)
    }

    ctx, _, member := mutationFixture(t, first)
    now := time.Now().UTC()
    a := sessionFixture(t, first, member, "mysql-session-first", now.Add(time.Hour))
    b := sessionFixture(t, first, member, "mysql-session-second", now.Add(time.Hour))
    sessionFixture(t, first, member, "mysql-session-expired", now.Add(-time.Minute))
    rows, err := second.ListUserSessions(ctx, member.ID, 1, 0)
    if err != nil || len(rows) != 1 || rows[0].ID != b.ID {
        t.Fatal(rows, err)
    }

    rows, err = second.ListUserSessions(ctx, member.ID, 1, 1)
    if err != nil || len(rows) != 1 || rows[0].ID != a.ID {
        t.Fatal(rows, err)
    }

    connection := second.connectionContext(context.Background(), b.Token, member)
    if err = first.RevokeUserSession(ctx, member.ID, b.ID); err != nil {
        t.Fatal(err)
    }
    if err = ValidateConnection(connection); !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }
    if _, _, err = second.Resolve(ctx, a.Token); err != nil {
        t.Fatal(err)
    }

    rows, err = second.ListUserSessions(ctx, member.ID, 20, 0)
    if err != nil || len(rows) != 1 || rows[0].ID != a.ID {
        t.Fatal(rows, err)
    }
}

func TestSQLiteSessionAbsoluteTimeOrdering(t *testing.T) {
    s := testService(t)
    ctx, _, member := mutationFixture(t, s)
    now := time.Now().UTC()
    older := sessionFixture(t, s, member, "older-offset", now.Add(time.Hour))
    newer := sessionFixture(t, s, member, "newer-utc", now.Add(time.Hour))
    expired := sessionFixture(t, s, member, "expired-rfc3339", now.Add(time.Hour))
    // UTC+8 的旧记录在文本排序中更大；实际顺序由绝对时间决定。
    if err := s.db.Model(&older).UpdateColumn("created_at", now.Add(-time.Hour).In(time.FixedZone("CST", 8*3600))).Error; err != nil {
        t.Fatal(err)
    }
    if err := s.db.Model(&newer).UpdateColumn("created_at", now.Format(time.RFC3339Nano)).Error; err != nil {
        t.Fatal(err)
    }
    if err := s.db.Model(&expired).UpdateColumn("expires_at", now.Add(-time.Second).Format(time.RFC3339Nano)).Error; err != nil {
        t.Fatal(err)
    }

    rows, err := s.ListUserSessions(ctx, member.ID, 20, 0)
    if err != nil || len(rows) != 2 || rows[0].ID != newer.ID || rows[1].ID != older.ID {
        t.Fatal(rows, err)
    }
}
