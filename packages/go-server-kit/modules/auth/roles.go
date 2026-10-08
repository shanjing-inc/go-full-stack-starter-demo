package auth

import (
    "context"
    "strings"

    "gorm.io/gorm"
)

// HasRole 按旧认证的逗号分隔角色逐项匹配，保持角色大小写与完整名称。
func HasRole(user *User, roles ...string) bool {
    if user == nil || user.Role == nil {
        return false
    }

    for _, actual := range strings.Split(*user.Role, ",") {
        for _, expected := range roles {
            if expected != "" && actual == expected {
                return true
            }
        }
    }

    return false
}

// administratorExists 按各数据库方言匹配完整 owner/admin 角色，供初始化事务和安装状态查询复用。
func administratorExists(ctx context.Context, db *gorm.DB) (bool, error) {
    // 按逗号边界匹配，并使各方言的数据库判断与 HasRole 的大小写规则一致。
    column, operator, wildcard := "role", "GLOB", "*"
    switch db.Dialector.Name() {
    case "mysql":
        column, operator, wildcard = "BINARY role", "LIKE", "%"
    case "postgres":
        column, operator, wildcard = `role COLLATE "C"`, "LIKE", "%"
    }

    query := db.WithContext(ctx).Model(&User{}).Where(column+" IN ?", []string{"owner", "admin"})
    for _, role := range []string{"owner", "admin"} {
        for _, pattern := range []string{
            role + "," + wildcard,
            wildcard + "," + role,
            wildcard + "," + role + "," + wildcard,
        } {
            query = query.Or(column+" "+operator+" ?", pattern)
        }
    }

    var count int64
    err := query.Count(&count).Error
    return count > 0, err
}
