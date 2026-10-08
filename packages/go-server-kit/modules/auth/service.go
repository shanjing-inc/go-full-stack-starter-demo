// Package auth 提供兼容账号、会话、权限及管理操作，写入在事务内复核身份。
package auth

import (
    "context"
    "crypto/rand"
    "crypto/subtle"
    "encoding/hex"
    "errors"
    "gorm.io/gorm"
    "net/mail"
    "strconv"
    "strings"
    "time"
)

// ErrCredentials 表示邮箱或密码校验失败。
var ErrCredentials = errors.New("邮箱或密码错误")

// ErrUnauthorized 表示认证信息无效，需要重新登录。
var ErrUnauthorized = errors.New("请重新登录")

// ErrInstalled 表示数据库中已经存在管理员。
var ErrInstalled = errors.New("管理员已初始化")

// ErrDisabled 表示初始化密钥为空，初始化入口保持关闭。
var ErrDisabled = errors.New("初始化入口已关闭")

// ErrBanned 表示账号处于有效封禁期内。
var ErrBanned = errors.New("账号已被封禁")

// Config 配置签名密钥、Cookie、来源白名单、路径权限和审计回调；初始化入口由 BootstrapToken 控制。
type Config struct {
    Secret               string
    CookieName           string
    Secure               bool
    Origins              []string
    BootstrapToken       string
    AdminPaths           []string
    DashboardPath        string
    DashboardPermissions func(*User) []string
    Permissions          RolePermissions
    PathPermissions      map[string]Permission
    Audit                AuditSink
}

// Service 组合数据库、认证配置和角色权限快照，供 HTTP 与业务管理入口共享。
type Service struct {
    db          *gorm.DB
    config      Config
    dummy       string
    permissions RolePermissions
}

// New 校验密钥和数据库、补齐 Cookie 名并复制权限配置；调用方负责数据库生命周期。
func New(db *gorm.DB, config Config) (*Service, error) {
    if db == nil || len(config.Secret) < 32 {
        return nil, errors.New("认证需要数据库和至少 32 字节密钥")
    }
    if config.CookieName == "" {
        config.CookieName = "better-auth.session_token"
        if config.Secure {
            config.CookieName = "__Secure-better-auth.session_token"
        }
    }
    if config.BootstrapToken != "" && len(config.BootstrapToken) < 32 {
        return nil, errors.New("初始化密钥至少需要 32 字节")
    }

    dummy, err := PasswordHash("dummy-password-for-timing")
    if err != nil {
        return nil, err
    }

    paths := map[string]Permission{}
    for path, permission := range config.PathPermissions {
        paths[path] = permission
    }

    config.PathPermissions = paths
    return &Service{
        db:          db,
        config:      config,
        dummy:       dummy,
        permissions: clonePermissions(config.Permissions),
    }, nil
}

// emailValue 去除首尾空白并转为小写，接受最多 255 字节的纯邮箱地址。
func emailValue(email string) (string, error) {
    email = strings.ToLower(strings.TrimSpace(email))
    value, err := mail.ParseAddress(email)
    if err != nil || value.Address != email || len(email) > 255 {
        return "", errors.New("邮箱格式无效")
    }
    return email, nil
}

// Installed 检查数据库中是否存在具有完整 owner 或 admin 角色的账号。
func (s *Service) Installed(ctx context.Context) (bool, error) {
    return administratorExists(ctx, s.db)
}

// Initialize 校验初始化密钥，在单例行锁保护下原子创建 owner 与密码账号。
func (s *Service) Initialize(ctx context.Context, token, name, email, password string) (*User, error) {
    if s.config.BootstrapToken == "" {
        return nil, ErrDisabled
    }
    if subtle.ConstantTimeCompare([]byte(token), []byte(s.config.BootstrapToken)) != 1 {
        return nil, ErrUnauthorized
    }

    email, err := emailValue(email)
    if err != nil {
        return nil, err
    }

    name = strings.TrimSpace(name)
    if name == "" || len(name) > 255 {
        return nil, errors.New("名称长度需要 1–255 字节")
    }

    hash, err := PasswordHash(password)
    if err != nil {
        return nil, err
    }

    role := "owner"
    user := &User{Name: name, Email: email, Role: &role}
    err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
        // UPDATE 获取行锁；所有进程按同一顺序锁定单例行后检查管理员。
        lock := tx.Model(&Bootstrap{}).Where("id = 1").UpdateColumn("revision", gorm.Expr("revision + 1"))
        if lock.Error != nil {
            return lock.Error
        }
        if lock.RowsAffected != 1 {
            return errors.New("初始化锁行缺失，请执行迁移")
        }

        installed, err := administratorExists(ctx, tx)
        if err != nil {
            return err
        }
        if installed {
            return ErrInstalled
        }
        if err := tx.Create(user).Error; err != nil {
            return err
        }
        return tx.Create(&Account{
            AccountID:  strconv.Itoa(user.ID),
            ProviderID: "credential",
            UserID:     user.ID,
            Password:   &hash,
        }).Error
    })
    if err != nil {
        return nil, err
    }
    return user, nil
}

// banned 按封禁标记和绝对到期时间判断账号状态，空到期时间表示持续封禁。
func banned(user User, now time.Time) bool {
    return user.Banned != nil && *user.Banned && (user.BanExpires == nil || user.BanExpires.After(now))
}

// Login 验证邮箱密码并创建七天会话；事务内再次检查账号、封禁及密码哈希。
func (s *Service) Login(ctx context.Context, email, password, ip, agent string) (*Session, *User, error) {
    normalized, invalid := emailValue(email)
    var user User
    err := s.db.WithContext(ctx).Where("email = ?", normalized).Take(&user).Error
    if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
        return nil, nil, err
    }

    var account Account
    hash := s.dummy
    if err == nil && invalid == nil {
        err = s.db.WithContext(ctx).Where("user_id = ? AND provider_id = ?", user.ID, "credential").Take(&account).Error
        if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
            return nil, nil, err
        }
        if err == nil && account.Password != nil {
            hash = *account.Password
        }
    }

    matches, verifyErr := verifyPassword(hash, password)
    if verifyErr != nil {
        return nil, nil, verifyErr
    }
    if invalid != nil || err != nil || account.Password == nil || !matches {
        return nil, nil, ErrCredentials
    }

    now := time.Now().UTC().Truncate(time.Second)
    if banned(user, now) {
        return nil, nil, ErrBanned
    }

    bytes := make([]byte, 32)
    if _, err := rand.Read(bytes); err != nil {
        return nil, nil, err
    }
    if len(ip) > 255 {
        ip = ""
    }
    if len(agent) > 1024 {
        agent = agent[:1024]
    }

    session := &Session{
        Token:     hex.EncodeToString(bytes),
        UserID:    user.ID,
        ExpiresAt: now.Add(7 * 24 * time.Hour),
        IPAddress: &ip,
        UserAgent: &agent,
    }
    // 密码派生在锁外完成，写入会话时与封禁／角色／撤销操作按同一单例锁排序。
    err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
        if err := lockAdministration(tx); err != nil {
            return err
        }

        var current User
        if err := tx.First(&current, user.ID).Error; err != nil {
            if errors.Is(err, gorm.ErrRecordNotFound) {
                return ErrCredentials
            }
            return err
        }
        if banned(current, time.Now().UTC()) {
            return ErrBanned
        }

        var credential Account
        if err := tx.Where("user_id = ? AND provider_id = ?", user.ID, "credential").Take(&credential).Error; err != nil {
            if errors.Is(err, gorm.ErrRecordNotFound) {
                return ErrCredentials
            }
            return err
        }
        if credential.Password == nil || subtle.ConstantTimeCompare([]byte(*credential.Password), []byte(hash)) != 1 {
            return ErrCredentials
        }

        user = current
        return tx.Create(session).Error
    })
    if err != nil {
        return nil, nil, err
    }
    return session, &user, nil
}

// Resolve 校验令牌和当前账号，距上次更新超过一天时将有效会话续期至七天。
func (s *Service) Resolve(ctx context.Context, token string) (*Session, *User, error) {
    return s.resolve(ctx, token, true)
}

// resolve 的长连接复核模式保持数据库有效期，HTTP 请求继续使用滑动续期。
func (s *Service) resolve(ctx context.Context, token string, renew bool) (*Session, *User, error) {
    if token == "" || len(token) > 255 {
        return nil, nil, ErrUnauthorized
    }

    now := time.Now().UTC().Truncate(time.Second)
    var session Session
    err := s.db.WithContext(ctx).Where("token = ?", token).Take(&session).Error
    if errors.Is(err, gorm.ErrRecordNotFound) {
        return nil, nil, ErrUnauthorized
    }
    if err != nil {
        return nil, nil, err
    }
    // Go 按时间点校验，兼容 SQLite 旧数据带时区的 DATETIME 文本。
    if !session.ExpiresAt.After(now) {
        return nil, nil, ErrUnauthorized
    }

    var user User
    err = s.db.WithContext(ctx).First(&user, session.UserID).Error
    if errors.Is(err, gorm.ErrRecordNotFound) {
        return nil, nil, ErrUnauthorized
    }
    if err != nil {
        return nil, nil, err
    }
    if banned(user, now) {
        return nil, nil, ErrBanned
    }
    if renew && session.UpdatedAt.Before(now.Add(-24*time.Hour)) {
        expiry := now.Add(7 * 24 * time.Hour)
        result := s.db.WithContext(ctx).Model(&Session{}).Where("id = ? AND expires_at > ?", session.ID, now).Updates(map[string]any{"expires_at": expiry, "updated_at": now})
        if result.Error != nil {
            return nil, nil, result.Error
        }
        if result.RowsAffected == 0 {
            return nil, nil, ErrUnauthorized
        }

        session.ExpiresAt = expiry
        session.UpdatedAt = now
    }
    return &session, &user, nil
}

// Logout 按令牌删除会话，重复调用保持幂等。
func (s *Service) Logout(ctx context.Context, token string) error {
    return s.db.WithContext(ctx).Where("token = ?", token).Delete(&Session{}).Error
}

type identityKey struct{}

// WithUser 把已解析的身份写入请求上下文；后续写操作仍会读取数据库复核权限。
func WithUser(ctx context.Context, user *User) context.Context {
    return context.WithValue(ctx, identityKey{}, user)
}

// UserFrom 读取请求上下文中的身份及类型匹配结果。
func UserFrom(ctx context.Context) (*User, bool) {
    user, ok := ctx.Value(identityKey{}).(*User)
    return user, ok
}

// loginLimitKey 与 Login 使用相同数据库匹配规则；旧库大小写和重音别名共享账号桶。
func (s *Service) loginLimitKey(ctx context.Context, email string) (string, error) {
    normalized, invalid := emailValue(email)
    if invalid != nil {
        return "email:" + strings.ToLower(strings.TrimSpace(email)), nil
    }

    var user User
    err := s.db.WithContext(ctx).Select("id").Where("email = ?", normalized).Take(&user).Error
    if errors.Is(err, gorm.ErrRecordNotFound) {
        return "email:" + normalized, nil
    }
    if err != nil {
        return "", err
    }
    return "account:" + strconv.Itoa(user.ID), nil
}
