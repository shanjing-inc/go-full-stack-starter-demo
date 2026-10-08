package auth

// 本文件覆盖长连接会话复核及原到期时间保持，约束握手后持续授权的生命周期。

import (
    "context"
    "errors"
    "testing"
    "time"
)

func TestConnectionSessionValidation(t *testing.T) {
    for _, mode := range []string{
        "退出撤销",
        "封禁",
        "过期",
        "带时区过期",
        "角色变更",
        "权限变更",
        "删除用户",
        "数据库故障",
    } {
        t.Run(mode, func(t *testing.T) {
            s := testService(t)
            user := initialize(t, s)
            session, _, err := s.Login(context.Background(), user.Email, password, "", "")
            if err != nil {
                t.Fatal(err)
            }

            ctx := s.connectionContext(context.Background(), session.Token, user)
            if err = ValidateConnection(ctx); err != nil {
                t.Fatal(err)
            }
            // 第二个认证服务模拟其他实例更新共享数据库。
            other, err := New(s.db, Config{Secret: secret})
            if err != nil {
                t.Fatal(err)
            }

            switch mode {
            case "退出撤销":
                err = other.Logout(context.Background(), session.Token)
            case "封禁":
                err = s.db.Model(user).Update("banned", true).Error
            case "过期":
                err = s.db.Model(session).Update("expires_at", time.Now().Add(-time.Hour).UTC()).Error
            case "带时区过期":
                err = s.db.Model(session).Update("expires_at", time.Now().Add(-time.Hour).In(time.FixedZone("UTC+8", 8*60*60))).Error
            case "角色变更":
                err = s.db.Model(user).Update("role", "admin").Error
            case "权限变更":
                // 应用权限别名可以受最新用户状态影响。
                s.config.DashboardPermissions = func(current *User) []string {
                    if current.Name == "新名称" {
                        return []string{"changed:permission"}
                    }
                    return nil
                }
                err = s.db.Model(user).Update("name", "新名称").Error
            case "删除用户":
                err = s.db.Delete(user).Error
            case "数据库故障":
                sql, _ := s.db.DB()
                err = sql.Close()
            }

            if err != nil {
                t.Fatal(err)
            }
            if err = ValidateConnection(ctx); err == nil {
                t.Fatal("失效连接继续通过复核")
            }
        })
    }

    if err := ValidateConnection(context.Background()); err != nil {
        t.Fatal("公开样例上下文", err)
    }
}

func TestConnectionValidationKeepsExpiry(t *testing.T) {
    s := testService(t)
    user := initialize(t, s)
    now := time.Now().UTC().Truncate(time.Second)
    session := Session{
        Token:     "old-connection-session",
        UserID:    user.ID,
        ExpiresAt: now.Add(time.Hour),
        UpdatedAt: now.Add(-48 * time.Hour),
    }
    if err := s.db.Create(&session).Error; err != nil {
        t.Fatal(err)
    }

    ctx := s.connectionContext(context.Background(), session.Token, user)
    if err := ValidateConnection(ctx); err != nil {
        t.Fatal(err)
    }

    var stored Session
    if err := s.db.First(&stored, session.ID).Error; err != nil {
        t.Fatal(err)
    }
    if !stored.ExpiresAt.Equal(session.ExpiresAt) || !stored.UpdatedAt.Equal(session.UpdatedAt) {
        t.Fatal("长连接改变了有效期")
    }

    refreshed, _, err := s.Resolve(context.Background(), session.Token)
    if err != nil || !refreshed.ExpiresAt.After(session.ExpiresAt) {
        t.Fatal("HTTP 滑动续期失败", err)
    }
    if err = s.Logout(context.Background(), session.Token); err != nil {
        t.Fatal(err)
    }
    if err = ValidateConnection(ctx); !errors.Is(err, ErrUnauthorized) {
        t.Fatal(err)
    }
}
