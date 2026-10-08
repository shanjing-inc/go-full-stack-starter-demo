package auth

import (
    "cmp"
    "context"
    "errors"
    "fmt"
    "slices"
    "strconv"
    "time"

    "gorm.io/gorm"
    "gorm.io/gorm/clause"
)

type sessionIDKey struct{}

// SessionInfo 是后台会话投影，查询和返回值均排除认证令牌。
type SessionInfo struct {
    ID        int
    UserID    int
    IPAddress *string
    UserAgent *string
    CreatedAt time.Time
    UpdatedAt time.Time
    ExpiresAt time.Time
    Current   bool `gorm:"-"`
}

// ListUserSessions 仅列出有效期内的会话，按创建时间及 ID 倒序分页。
func (s *Service) ListUserSessions(ctx context.Context, userID, limit, offset int) (rows []SessionInfo, err error) {
    defer func() { s.record(ctx, "session", "list", strconv.Itoa(userID), err) }()
    if err = s.Require(ctx, "session", "list"); err != nil {
        return nil, err
    }
    if userID <= 0 || userID > 2147483647 {
        return nil, userInput("用户 ID 需要有效的正整数")
    }
    if limit == 0 {
        limit = 20
    }
    if limit < 1 || limit > 101 || offset < 0 || offset > 1000000 {
        return nil, userInput("会话分页参数超出范围")
    }

    rows = []SessionInfo{}
    err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
        identity, _ := UserFrom(ctx)
        var actor User
        e := tx.First(&actor, identity.ID).Error
        if errors.Is(e, gorm.ErrRecordNotFound) || e == nil && banned(actor, time.Now().UTC()) {
            return forbiddenMutation("当前账号已失效")
        }
        if e != nil {
            return e
        }
        if !s.Allows(&actor, "session", "list") {
            return forbiddenMutation("当前账号缺少所需权限")
        }

        var target User
        e = tx.First(&target, userID).Error
        if errors.Is(e, gorm.ErrRecordNotFound) {
            return userInput("用户不存在")
        }
        if e != nil {
            return e
        }
        if e = s.canManage(&actor, &target); e != nil {
            return e
        }

        query := tx.Model(&Session{}).Select("id", "user_id", "ip_address", "user_agent", "created_at", "updated_at", "expires_at").Where("user_id = ?", userID)
        now := time.Now().UTC()
        if tx.Dialector.Name() == "sqlite" {
            // SQLite 测试库兼容驱动 time.String 与旧 RFC3339 存储，使用解析后的绝对时间排序和分页。
            var candidates []SessionInfo
            if e := query.Find(&candidates).Error; e != nil {
                return e
            }

            for _, row := range candidates {
                if row.ExpiresAt.After(now) {
                    rows = append(rows, row)
                }
            }

            slices.SortFunc(rows, func(a, b SessionInfo) int {
                if order := b.CreatedAt.Compare(a.CreatedAt); order != 0 {
                    return order
                }
                return cmp.Compare(b.ID, a.ID)
            })
            start := min(offset, len(rows))
            rows = rows[start:min(start+limit, len(rows))]
            return nil
        }
        return query.Where("expires_at > ?", now).Order("created_at DESC").Order("id DESC").Limit(limit).Offset(offset).Find(&rows).Error
    })
    if err != nil {
        return nil, err
    }

    current, _ := ctx.Value(sessionIDKey{}).(int)
    for i := range rows {
        rows[i].Current = rows[i].ID == current
    }

    return rows, nil
}

// RevokeUserSession 按用户与会话双重限定删除；重复撤销保持幂等。
func (s *Service) RevokeUserSession(ctx context.Context, userID, sessionID int) (err error) {
    defer func() { s.record(ctx, "session", "revoke-one", fmt.Sprintf("%d/%d", userID, sessionID), err) }()
    if err = s.Require(ctx, "session", "revoke"); err != nil {
        return err
    }
    if userID <= 0 || userID > 2147483647 || sessionID <= 0 || sessionID > 2147483647 {
        return userInput("用户及会话 ID 需要有效的正整数")
    }
    return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
        if e := lockAdministration(tx); e != nil {
            return e
        }

        actor, e := s.mutationActor(ctx, tx, Permission{"session", "revoke"})
        if e != nil {
            return e
        }

        var target User
        e = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&target, userID).Error
        if errors.Is(e, gorm.ErrRecordNotFound) {
            return userInput("用户不存在")
        }
        if e != nil {
            return e
        }
        if e = s.canManage(actor, &target); e != nil {
            return e
        }
        return tx.Where("user_id = ? AND id = ?", userID, sessionID).Delete(&Session{}).Error
    })
}
