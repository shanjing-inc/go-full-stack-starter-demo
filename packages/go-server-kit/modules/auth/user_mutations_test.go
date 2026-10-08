package auth

// 本文件覆盖用户创建原子性、字段权限、owner 保护、显式清空、批量事务与封禁后的会话撤销。

import (
    "context"
    "errors"
    "fmt"
    "os"
    "strings"
    "testing"
    "time"

    "gorm.io/gorm"
)

func mutationFixture(t *testing.T, s *Service) (context.Context, *User, *User) {
    t.Helper()
    owner := initialize(t, s)
    ctx := WithUser(context.Background(), owner)
    admin, err := s.CreateUser(ctx, CreateUserInput{
        Name:     "管理员二",
        Email:    "admin@example.test",
        Password: password,
        Role:     pointer("admin"),
    })
    if err != nil {
        t.Fatal(err)
    }

    member, err := s.CreateUser(ctx, CreateUserInput{
        Name:     "成员",
        Email:    "member@example.test",
        Password: password,
        Role:     pointer("member"),
    })
    if err != nil {
        t.Fatal(err)
    }
    return ctx, admin, member
}

func mutationWhere(id int) UserFilters { return UserFilters{ID: &IntCondition{Eq: pointer(id)}} }

func TestUserCreationAtomicAndCredentials(t *testing.T) {
    s := testService(t)
    owner := initialize(t, s)
    ctx := WithUser(context.Background(), owner)
    var events []AuditEvent
    s.config.Audit = func(_ context.Context, e AuditEvent) { events = append(events, e) }
    input := CreateUserInput{
        Name:     " 新用户 ",
        Email:    " NEW@EXAMPLE.TEST ",
        Password: "密码兼容123456789",
    }
    user, err := s.CreateUser(ctx, input)
    if err != nil || user.Name != "新用户" || user.Email != "new@example.test" || *user.Role != "user" {
        t.Fatal(user, err)
    }

    session, _, err := s.Login(ctx, input.Email, input.Password, "", "")
    if err != nil || session.UserID != user.ID {
        t.Fatal(err)
    }

    var account Account
    if err := s.db.Where("user_id = ?", user.ID).Take(&account).Error; err != nil || account.Password == nil || !PasswordMatches(*account.Password, input.Password) {
        t.Fatal(account.ID, err)
    }

    _, err = s.CreateUser(ctx, input)
    assertUserError(t, err, "BAD_USER_INPUT")
    for _, change := range []CreateUserInput{
        {Name: "", Email: "valid@example.test", Password: password},
        {Name: "甲", Email: "invalid", Password: password},
        {Name: "甲", Email: "valid@example.test", Password: "short"},
        {
            Name:     "甲",
            Email:    "valid@example.test",
            Password: password,
            Role:     pointer("unknown"),
        },
    } {
        _, err := s.CreateUser(ctx, change)
        assertUserError(t, err, "BAD_USER_INPUT")
    }

    for _, role := range []string{"owner", "user,owner"} {
        _, err := s.CreateUser(ctx, CreateUserInput{
            Name:     "甲",
            Email:    "valid@example.test",
            Password: password,
            Role:     &role,
        })
        assertUserError(t, err, "FORBIDDEN")
    }

    s.db.Callback().Create().Before("gorm:create").Register("test:account-failure", func(tx *gorm.DB) {
        if tx.Statement.Table == "account" {
            tx.AddError(errors.New("受控写入故障"))
        }
    })
    _, err = s.CreateUser(ctx, CreateUserInput{
        Name:     "回滚",
        Email:    "rollback@example.test",
        Password: password,
    })
    if err == nil {
        t.Fatal("预期事务回滚")
    }

    var count int64
    s.db.Model(&User{}).Where("email = ?", "rollback@example.test").Count(&count)
    if count != 0 {
        t.Fatal("用户与凭据应原子创建")
    }
    if len(events) != 9 || events[0].Target != fmt.Sprint(user.ID) || events[0].Result != "success" {
        t.Fatal(events)
    }

    for _, event := range events {
        if strings.Contains(fmt.Sprint(event), input.Password) || strings.Contains(fmt.Sprint(event), "@") {
            t.Fatal("审计包含敏感信息")
        }
    }
}

func TestUserMutationPermissionsAndOwnerProtection(t *testing.T) {
    s := testService(t)
    ownerCtx, admin, member := mutationFixture(t, s)
    adminCtx := WithUser(context.Background(), admin)
    for _, ctx := range []context.Context{context.Background(), WithUser(context.Background(), member)} {
        _, err := s.CreateUser(ctx, CreateUserInput{Name: "甲", Email: "valid@example.test", Password: password})
        assertUserError(t, err, "FORBIDDEN")
        _, err = s.UpdateUsers(ctx, mutationWhere(member.ID), UpdateUserInput{Name: pointer("乙")})
        assertUserError(t, err, "FORBIDDEN")
        err = s.RevokeUserSessions(ctx, member.ID)
        assertUserError(t, err, "FORBIDDEN")
    }

    for _, set := range []UpdateUserInput{
        {Name: pointer("越权")},
        {Role: pointer("admin")},
        {Banned: pointer(true)},
    } {
        _, err := s.UpdateUsers(adminCtx, mutationWhere(1), set)
        assertUserError(t, err, "FORBIDDEN")
    }

    assertUserError(t, s.RevokeUserSessions(adminCtx, 1), "FORBIDDEN")
    for _, set := range []UpdateUserInput{{Role: pointer("member")}, {Banned: pointer(true)}} {
        _, err := s.UpdateUsers(adminCtx, mutationWhere(admin.ID), set)
        assertUserError(t, err, "FORBIDDEN")
        _, err = s.UpdateUsers(ownerCtx, mutationWhere(1), set)
        assertUserError(t, err, "FORBIDDEN")
    }

    _, err := s.UpdateUsers(ownerCtx, mutationWhere(member.ID), UpdateUserInput{Role: pointer("owner")})
    assertUserError(t, err, "FORBIDDEN")
    // 角色降级在数据库生效，旧 context 随下一次写操作重新校验。
    _, err = s.UpdateUsers(ownerCtx, mutationWhere(admin.ID), UpdateUserInput{Role: pointer("member")})
    if err != nil {
        t.Fatal(err)
    }

    _, err = s.UpdateUsers(adminCtx, mutationWhere(member.ID), UpdateUserInput{Name: pointer("越权")})
    assertUserError(t, err, "FORBIDDEN")
    // 批量目标含 owner 时全部回滚。
    _, err = s.UpdateUsers(WithUser(context.Background(), &User{ID: admin.ID, Role: pointer("admin")}), UserFilters{ID: &IntCondition{InArray: []int{1, member.ID}}}, UpdateUserInput{Name: pointer("批量")})
    assertUserError(t, err, "FORBIDDEN")
}

func TestUserUpdateNullSemanticsAndSessionRevocation(t *testing.T) {
    s := testService(t)
    ctx, _, member := mutationFixture(t, s)
    session, _, err := s.Login(context.Background(), member.Email, password, "", "")
    if err != nil {
        t.Fatal(err)
    }

    expires := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
    rows, err := s.UpdateUsers(ctx, mutationWhere(member.ID), UpdateUserInput{
        Banned:     pointer(true),
        BanReason:  Optional[string]{Set: true, Value: pointer("测试封禁")},
        BanExpires: Optional[time.Time]{Set: true, Value: &expires},
    })
    if err != nil || len(rows) != 1 || !*rows[0].Banned {
        t.Fatal(rows, err)
    }

    _, _, err = s.Resolve(context.Background(), session.Token)
    if !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }

    _, _, err = s.Login(context.Background(), member.Email, password, "", "")
    if !errors.Is(err, ErrBanned) {
        t.Fatal(err)
    }

    rows, err = s.UpdateUsers(ctx, mutationWhere(member.ID), UpdateUserInput{
        Banned:     pointer(false),
        BanReason:  Optional[string]{Set: true},
        BanExpires: Optional[time.Time]{Set: true},
    })
    if err != nil || rows[0].BanReason != nil || rows[0].BanExpires != nil {
        t.Fatal(rows, err)
    }

    session, _, err = s.Login(context.Background(), member.Email, password, "", "")
    if err != nil {
        t.Fatal(err)
    }

    _, err = s.UpdateUsers(ctx, mutationWhere(member.ID), UpdateUserInput{Name: pointer("编辑资料")})
    if err != nil {
        t.Fatal(err)
    }
    if _, _, err = s.Resolve(context.Background(), session.Token); err != nil {
        t.Fatal("资料修改保持会话", err)
    }

    _, err = s.UpdateUsers(ctx, mutationWhere(member.ID), UpdateUserInput{Role: pointer("user")})
    if err != nil {
        t.Fatal(err)
    }
    if _, _, err = s.Resolve(context.Background(), session.Token); !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }

    session, _, err = s.Login(context.Background(), member.Email, password, "", "")
    if err != nil {
        t.Fatal(err)
    }
    if err = s.RevokeUserSessions(ctx, member.ID); err != nil {
        t.Fatal(err)
    }
    if _, _, err = s.Resolve(context.Background(), session.Token); !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }
    if err = s.RevokeUserSessions(ctx, member.ID); err != nil {
        t.Fatal("撤销应幂等", err)
    }

    _, err = s.UpdateUsers(ctx, UserFilters{}, UpdateUserInput{Name: pointer("危险")})
    assertUserError(t, err, "BAD_USER_INPUT")
    _, err = s.UpdateUsers(ctx, mutationWhere(member.ID), UpdateUserInput{})
    assertUserError(t, err, "BAD_USER_INPUT")
    assertUserError(t, s.RevokeUserSessions(ctx, 0), "BAD_USER_INPUT")
}

func TestUserMutationFieldPermissionsAndBatchAtomicity(t *testing.T) {
    s := testService(t)
    ctx, admin, member := mutationFixture(t, s)
    s.permissions["editor"] = []Permission{
        {"dashboard", "access:admin"},
        {"user", "update"},
        {"user", "create"},
    }
    editor := &User{
        Name:  "只可编辑",
        Email: "editor@example.test",
        Role:  pointer("editor"),
    }
    if err := s.db.Create(editor).Error; err != nil {
        t.Fatal(err)
    }

    editorCtx := WithUser(context.Background(), editor)
    _, err := s.UpdateUsers(editorCtx, mutationWhere(member.ID), UpdateUserInput{Name: pointer("编辑")})
    assertUserError(t, err, "FORBIDDEN") // editor 权限范围保护已有 member 角色。
    _, err = s.CreateUser(editorCtx, CreateUserInput{
        Name:     "普通用户",
        Email:    "user@example.test",
        Password: password,
    })
    if err != nil {
        t.Fatal(err)
    }

    for _, set := range []UpdateUserInput{
        {Role: pointer("user")},
        {Banned: pointer(true)},
        {BanReason: Optional[string]{Set: true}},
    } {
        _, err := s.UpdateUsers(editorCtx, mutationWhere(member.ID), set)
        assertUserError(t, err, "FORBIDDEN")
    }

    _, err = s.CreateUser(editorCtx, CreateUserInput{
        Name:     "提权",
        Email:    "escalate@example.test",
        Password: password,
        Role:     pointer("admin"),
    })
    assertUserError(t, err, "FORBIDDEN")
    // admin 更新批次中的 owner，任一拒绝回滚所有目标。
    _, err = s.UpdateUsers(WithUser(context.Background(), admin), UserFilters{ID: &IntCondition{InArray: []int{member.ID, 1}}}, UpdateUserInput{Name: pointer("批量越权")})
    assertUserError(t, err, "FORBIDDEN")
    var stored User
    if err = s.db.First(&stored, member.ID).Error; err != nil || stored.Name != member.Name {
        t.Fatal(stored, err)
    }

    session, _, err := s.Login(context.Background(), member.Email, password, "", "")
    if err != nil {
        t.Fatal(err)
    }
    s.db.Callback().Delete().Before("gorm:delete").Register("test:revoke-failure", func(tx *gorm.DB) {
        if tx.Statement.Table == "session" {
            tx.AddError(errors.New("受控撤销故障"))
        }
    })
    _, err = s.UpdateUsers(ctx, mutationWhere(member.ID), UpdateUserInput{Banned: pointer(true)})
    if err == nil {
        t.Fatal("预期撤销失败回滚")
    }
    if err = s.db.First(&stored, member.ID).Error; err != nil || stored.Banned != nil && *stored.Banned {
        t.Fatal(stored, err)
    }
    if _, _, err = s.Resolve(context.Background(), session.Token); err != nil {
        t.Fatal("回滚保留原会话", err)
    }
}

func TestLastAvailableOwnerProtected(t *testing.T) {
    s := testService(t)
    ctx, _, _ := mutationFixture(t, s)
    // 旧库允许多个 owner；封禁中的操作者由 mutationActor 拒绝。
    other := &User{
        Name:  "另一个owner",
        Email: "other-owner@example.test",
        Role:  pointer("user,owner"),
    }
    if err := s.db.Create(other).Error; err != nil {
        t.Fatal(err)
    }

    _, err := s.UpdateUsers(ctx, mutationWhere(other.ID), UpdateUserInput{Banned: pointer(true)})
    if err != nil {
        t.Fatal(err)
    }
    s.db.Model(&User{}).Where("id = 1").Update("banned", true)
    _, err = s.UpdateUsers(ctx, mutationWhere(other.ID), UpdateUserInput{Banned: pointer(false)})
    assertUserError(t, err, "FORBIDDEN")
    // 自定义拥有所有动作但没有 owner 角色的账号仍受 owner 门禁保护。
    s.permissions["root"] = DefaultRolePermissions()["owner"]
    root := &User{
        Name:  "自定义",
        Email: "root@example.test",
        Role:  pointer("root"),
    }
    if err = s.db.Create(root).Error; err != nil {
        t.Fatal(err)
    }

    _, err = s.UpdateUsers(WithUser(context.Background(), root), mutationWhere(other.ID), UpdateUserInput{Banned: pointer(true)})
    assertUserError(t, err, "FORBIDDEN")
}

func TestLoginRechecksBanBeforeSessionWrite(t *testing.T) {
    s := testService(t)
    ctx, _, member := mutationFixture(t, s)
    entered, release := make(chan struct{}), make(chan struct{})
    s.db.Callback().Query().After("gorm:query").Register("test:pause-credential", func(tx *gorm.DB) {
        if tx.Statement.Table == "account" {
            select {
            case <-entered:
            default:
                close(entered)
                <-release
            }
        }
    })
    result := make(chan error, 1)
    go func() {
        _, _, err := s.Login(context.Background(), member.Email, password, "", "")
        result <- err
    }()
    select {
    case <-entered:
    case <-time.After(3 * time.Second):
        close(release)
        t.Fatal("登录未到达凭据读取")
    }

    _, err := s.UpdateUsers(ctx, mutationWhere(member.ID), UpdateUserInput{Banned: pointer(true)})
    close(release)
    if err != nil {
        t.Fatal(err)
    }
    if err = <-result; !errors.Is(err, ErrBanned) {
        t.Fatal("登录写入前应复核封禁", err)
    }

    var count int64
    if err = s.db.Model(&Session{}).Where("user_id = ?", member.ID).Count(&count).Error; err != nil || count != 0 {
        t.Fatal(count, err)
    }
}

func TestUserMutationRequiresEffectiveFilter(t *testing.T) {
    s := testService(t)
    ctx, _, member := mutationFixture(t, s)
    for _, where := range []UserFilters{
        {ID: &IntCondition{NotInArray: []int{}}},
        {Email: &StringCondition{NotInArray: []string{}}},
        {Role: &StringCondition{NotInArray: []string{}}},
    } {
        _, err := s.UpdateUsers(ctx, where, UpdateUserInput{Name: pointer("全表变更")})
        assertUserError(t, err, "BAD_USER_INPUT")
    }

    rows, err := s.UpdateUsers(ctx, UserFilters{ID: &IntCondition{Eq: pointer(member.ID), NotInArray: []int{}}}, UpdateUserInput{Name: pointer("明确目标")})
    if err != nil || len(rows) != 1 || rows[0].Name != "明确目标" {
        t.Fatal(rows, err)
    }
}

// 独立 MySQL 数据库验证真实唯一约束及跨实例用户管理事务。
func TestMySQLUserManagementTransactions(t *testing.T) {
    dsn := os.Getenv("MYSQL_AUTH_TEST_DSN")
    if dsn == "" {
        t.Skip("需要独立 MYSQL_AUTH_TEST_DSN")
    }
    runDatabaseUserManagementTransactions(t, "mysql", dsn)
}

func TestPostgreSQLUserManagementTransactions(t *testing.T) {
    dsn := os.Getenv("POSTGRES_AUTH_TEST_DSN")
    if dsn == "" {
        t.Skip("需要独立 POSTGRES_AUTH_TEST_DSN")
    }
    runDatabaseUserManagementTransactions(t, "postgres", dsn)
}

func runDatabaseUserManagementTransactions(t *testing.T, driver, dsn string) {
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

    ctx, admin, member := mutationFixture(t, first)
    input := CreateUserInput{
        Name:     "并发创建",
        Email:    "parallel@example.test",
        Password: password,
    }
    start, results := make(chan struct{}), make(chan error, 2)
    for _, service := range []*Service{first, second} {
        go func(s *Service) {
            <-start
            _, err := s.CreateUser(ctx, input)
            results <- err
        }(service)
    }

    close(start)
    successes, failures := 0, 0
    for range 2 {
        if err := <-results; err == nil {
            successes++
        } else {
            assertUserError(t, err, "BAD_USER_INPUT")
            failures++
        }
    }

    if successes != 1 || failures != 1 {
        t.Fatal(successes, failures)
    }

    var accounts int64
    if err = db.Model(&Account{}).Count(&accounts).Error; err != nil || accounts != 4 {
        t.Fatal(accounts, err)
    }

    session, _, err := first.Login(context.Background(), member.Email, password, "", "")
    if err != nil {
        t.Fatal(err)
    }

    _, err = second.UpdateUsers(ctx, mutationWhere(member.ID), UpdateUserInput{Role: pointer("user")})
    if err != nil {
        t.Fatal(err)
    }
    if _, _, err = first.Resolve(context.Background(), session.Token); !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }
    // 登陆在凭据读取后等待，另一实例封禁在会话写入前完成。
    entered, release := make(chan struct{}), make(chan struct{})
    if err = first.db.Callback().Query().After("gorm:query").Register("test:mysql-credential", func(tx *gorm.DB) {
        if tx.Statement.Table == "account" {
            select {
            case <-entered:
            default:
                close(entered)
                <-release
            }
        }
    }); err != nil {
        t.Fatal(err)
    }

    login := make(chan error, 1)
    go func() {
        _, _, err := first.Login(context.Background(), member.Email, password, "", "")
        login <- err
    }()
    select {
    case <-entered:
    case <-time.After(3 * time.Second):
        close(release)
        t.Fatal("登录等待超时")
    }

    _, err = second.UpdateUsers(ctx, mutationWhere(member.ID), UpdateUserInput{Banned: pointer(true)})
    close(release)
    if err != nil {
        t.Fatal(err)
    }

    select {
    case err = <-login:
        if !errors.Is(err, ErrBanned) {
            t.Fatal(err)
        }
    case <-time.After(3 * time.Second):
        t.Fatal("登录返回超时")
    }
    // 两个 owner 并发互相封禁，单例锁与最新操作者状态保证仅一项成功。
    owner := initializeOwnerFromContext(t, ctx)
    peer := &User{
        Name:  "兼容owner",
        Email: "peer-owner@example.test",
        Role:  pointer("user,owner"),
    }
    if err = db.Create(peer).Error; err != nil {
        t.Fatal(err)
    }

    peerCtx := WithUser(context.Background(), peer)
    start, results = make(chan struct{}), make(chan error, 2)
    go func() {
        <-start
        _, err := first.UpdateUsers(ctx, mutationWhere(peer.ID), UpdateUserInput{Banned: pointer(true)})
        results <- err
    }()
    go func() {
        <-start
        _, err := second.UpdateUsers(peerCtx, mutationWhere(owner.ID), UpdateUserInput{Banned: pointer(true)})
        results <- err
    }()
    close(start)
    successes = 0
    for range 2 {
        if err := <-results; err == nil {
            successes++
        } else {
            assertUserError(t, err, "FORBIDDEN")
        }
    }

    if successes != 1 {
        t.Fatal("并发封禁需要保留一个可用owner", successes)
    }

    var owners []User
    if err = db.Where("id IN ?", []int{owner.ID, peer.ID}).Find(&owners).Error; err != nil {
        t.Fatal(err)
    }

    available := 0
    for _, owner := range owners {
        if !banned(owner, time.Now().UTC()) {
            available++
        }
    }

    if available != 1 {
        t.Fatal(available)
    }
    // MySQL 大小写不敏感预筛选后，owner 判断仍保持完整名称及大小写语义。
    if err = db.Model(&User{}).Where("id IN ?", []int{owner.ID, peer.ID}).Update("role", "OWNER").Error; err != nil {
        t.Fatal(err)
    }

    _, err = second.UpdateUsers(WithUser(context.Background(), admin), mutationWhere(member.ID), UpdateUserInput{Banned: pointer(false)})
    if err != nil {
        t.Fatal("大写角色保持权限语义", err)
    }
}

func initializeOwnerFromContext(t *testing.T, ctx context.Context) *User {
    t.Helper()
    owner, ok := UserFrom(ctx)
    if !ok {
        t.Fatal("owner上下文缺失")
    }
    return owner
}
