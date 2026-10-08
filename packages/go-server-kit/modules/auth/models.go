// Package auth 提供兼容既有表和邮箱密码的公共认证模块。
package auth

import "time"

// User 映射兼容用户表；指针字段保留数据库 NULL，Role 保存逗号分隔角色。
type User struct {
    ID            int        `gorm:"column:id;type:int;size:32;primaryKey;autoIncrement"`
    Name          string     `gorm:"column:name;type:varchar(255);not null"`
    Email         string     `gorm:"column:email;type:varchar(255);not null;uniqueIndex:user_email_unique"`
    EmailVerified bool       `gorm:"column:email_verified;type:boolean;not null;default:false"`
    Image         *string    `gorm:"column:image;type:text"`
    Role          *string    `gorm:"column:role;type:varchar(255);index:user_role_idx"`
    Banned        *bool      `gorm:"column:banned;type:boolean;default:false"`
    BanReason     *string    `gorm:"column:ban_reason;type:text"`
    BanExpires    *time.Time `gorm:"column:ban_expires;precision:0"`
    CreatedAt     time.Time  `gorm:"column:created_at;precision:0;not null;default:CURRENT_TIMESTAMP"`
    UpdatedAt     time.Time  `gorm:"column:updated_at;precision:0;not null;default:CURRENT_TIMESTAMP"`
}

// TableName 固定映射到兼容认证表 user。
func (User) TableName() string { return "user" }

// Session 保存登录令牌及绝对有效期；后台列表使用 SessionInfo 安全投影。
type Session struct {
    ID             int       `gorm:"column:id;type:int;size:32;primaryKey;autoIncrement"`
    ExpiresAt      time.Time `gorm:"column:expires_at;precision:0;not null"`
    Token          string    `gorm:"column:token;type:varchar(255);not null;uniqueIndex:session_token_unique"`
    IPAddress      *string   `gorm:"column:ip_address;type:varchar(255)"`
    UserAgent      *string   `gorm:"column:user_agent;type:text"`
    UserID         int       `gorm:"column:user_id;type:int;size:32;not null;index:session_user_id_idx"`
    ImpersonatedBy *string   `gorm:"column:impersonated_by;type:varchar(255)"`
    CreatedAt      time.Time `gorm:"column:created_at;precision:0;not null;default:CURRENT_TIMESTAMP"`
    UpdatedAt      time.Time `gorm:"column:updated_at;precision:0;not null;default:CURRENT_TIMESTAMP"`
}

// TableName 固定映射到兼容认证表 session。
func (Session) TableName() string { return "session" }

// Account 保存按提供方和账号标识唯一的登录身份，credential 身份使用 Password 哈希。
type Account struct {
    ID                    int        `gorm:"column:id;type:int;size:32;primaryKey;autoIncrement"`
    AccountID             string     `gorm:"column:account_id;type:varchar(255);not null;uniqueIndex:account_provider_account_unique,priority:2"`
    ProviderID            string     `gorm:"column:provider_id;type:varchar(255);not null;uniqueIndex:account_provider_account_unique,priority:1"`
    UserID                int        `gorm:"column:user_id;type:int;size:32;not null;index:account_user_id_idx"`
    AccessToken           *string    `gorm:"column:access_token;type:text"`
    RefreshToken          *string    `gorm:"column:refresh_token;type:text"`
    IDToken               *string    `gorm:"column:id_token;type:text"`
    AccessTokenExpiresAt  *time.Time `gorm:"column:access_token_expires_at;precision:0"`
    RefreshTokenExpiresAt *time.Time `gorm:"column:refresh_token_expires_at;precision:0"`
    Scope                 *string    `gorm:"column:scope;type:text"`
    Password              *string    `gorm:"column:password;type:text"`
    CreatedAt             time.Time  `gorm:"column:created_at;precision:0;not null;default:CURRENT_TIMESTAMP"`
    UpdatedAt             time.Time  `gorm:"column:updated_at;precision:0;not null;default:CURRENT_TIMESTAMP"`
}

// TableName 固定映射到兼容认证表 account。
func (Account) TableName() string { return "account" }

// Verification 保存验证标识、验证值和绝对有效期。
type Verification struct {
    ID         int       `gorm:"column:id;type:int;size:32;primaryKey;autoIncrement"`
    Identifier string    `gorm:"column:identifier;type:varchar(255);not null;index:verification_identifier_idx"`
    Value      string    `gorm:"column:value;type:text;not null"`
    ExpiresAt  time.Time `gorm:"column:expires_at;precision:0;not null"`
    CreatedAt  time.Time `gorm:"column:created_at;precision:0;not null;default:CURRENT_TIMESTAMP"`
    UpdatedAt  time.Time `gorm:"column:updated_at;precision:0;not null;default:CURRENT_TIMESTAMP"`
}

// TableName 固定映射到兼容认证表 verification。
func (Verification) TableName() string { return "verification" }

// Bootstrap 是跨实例初始化互斥行，迁移时写入 ID=1。
type Bootstrap struct {
    ID       int `gorm:"column:id;type:int;size:32;primaryKey;autoIncrement:false"`
    Revision int `gorm:"column:revision;type:int;size:32;not null;default:0"`
}

// TableName 固定映射到兼容认证表 auth_bootstrap。
func (Bootstrap) TableName() string { return "auth_bootstrap" }

// Models 按迁移及代码生成使用的顺序返回全部认证模型。
func Models() []any { return []any{&User{}, &Session{}, &Account{}, &Verification{}, &Bootstrap{}} }
