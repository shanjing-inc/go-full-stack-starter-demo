package auth

// 本文件覆盖队列操作读取当前数据库身份并复核权限的边界。

import (
    "context"
    "testing"
)

func TestQueueAuthorizeCurrent(t *testing.T) {
    s := testService(t)
    for _, role := range []string{"owner", "admin", "member", "user"} {
        user := User{Name: role, Email: role + "-queue@example.test", Role: &role}
        if err := s.db.Create(&user).Error; err != nil {
            t.Fatal(err)
        }

        ctx := WithUser(context.Background(), &user)
        _, err := s.AuthorizeCurrent(ctx, "queue", "read", "retry")
        if role == "owner" || role == "admin" {
            if err != nil {
                t.Fatal(err)
            }
        } else {
            assertUserError(t, err, "FORBIDDEN")
        }
        if role == "admin" {
            if err = s.db.Model(&User{}).Where("id = ?", user.ID).Update("role", "user").Error; err != nil {
                t.Fatal(err)
            }

            _, err = s.AuthorizeCurrent(ctx, "queue", "read", "retry")
            assertUserError(t, err, "FORBIDDEN")
            if err = s.db.Model(&User{}).Where("id = ?", user.ID).Updates(map[string]any{"role": "admin", "banned": true}).Error; err != nil {
                t.Fatal(err)
            }

            _, err = s.AuthorizeCurrent(ctx, "queue", "read", "retry")
            assertUserError(t, err, "FORBIDDEN")
        }
    }

    policies := DefaultRolePermissions()
    policies["member"] = []Permission{{"queue", "read"}, {"queue", "retry"}}
    custom, err := New(s.db, Config{Secret: secret, Permissions: policies})
    if err != nil {
        t.Fatal(err)
    }

    var member User
    if err = s.db.Where("email = ?", "member-queue@example.test").First(&member).Error; err != nil {
        t.Fatal(err)
    }
    if _, err = custom.AuthorizeCurrent(WithUser(context.Background(), &member), "queue", "read", "retry"); err != nil {
        t.Fatal(err)
    }
}
