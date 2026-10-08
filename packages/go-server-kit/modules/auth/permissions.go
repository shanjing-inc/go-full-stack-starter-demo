package auth

import (
    "context"
    "errors"
    "gorm.io/gorm"
    "slices"
    "strings"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
)

// Permission 沿用参考项目的资源／动作命名；角色组合按完整名称取权限并集。
type Permission struct{ Resource, Action string }

// RolePermissions 按完整角色名配置资源与动作权限，组合角色使用各角色权限并集。
type RolePermissions map[string][]Permission

// DefaultRolePermissions 返回独立的默认角色权限表；owner 追加 system:owner 权限。
func DefaultRolePermissions() RolePermissions {
    all := []Permission{{"dashboard", "access:admin"}, {"dashboard", "access:member"},
        {"shop", "list"}, {"shop", "create"}, {"product", "list"}, {"order", "list"},
        {"queue", "read"}, {"queue", "retry"}, {"queue", "clean"},
        {"session", "list"}, {"session", "revoke"}, {"session", "delete"}}
    for _, action := range []string{
        "create",
        "list",
        "set-role",
        "ban",
        "impersonate",
        "delete",
        "set-password",
        "get",
        "update",
    } {
        all = append(all, Permission{"user", action})
    }

    return RolePermissions{
        "owner":  append(slices.Clone(all), Permission{"system", "owner"}),
        "admin":  slices.Clone(all),
        "member": {{"dashboard", "access:member"}},
        "user":   {},
    }
}

// clonePermissions 复制权限表及各角色切片，nil 输入使用默认配置。
func clonePermissions(input RolePermissions) RolePermissions {
    if input == nil {
        input = DefaultRolePermissions()
    }

    copy := RolePermissions{}
    for role, permissions := range input {
        copy[role] = slices.Clone(permissions)
    }

    return copy
}

// Allows 按逗号分隔的完整角色名检查资源与动作，身份无效时返回 false。
func (s *Service) Allows(user *User, resource, action string) bool {
    if user == nil || user.ID <= 0 || user.Role == nil || resource == "" || action == "" {
        return false
    }

    for _, role := range strings.Split(*user.Role, ",") {
        if slices.Contains(s.permissions[role], Permission{resource, action}) {
            return true
        }
    }

    return false
}

// Permissions 返回身份拥有的去重权限键，并按字典序排列；空身份返回空切片。
func (s *Service) Permissions(user *User) []string {
    result := []string{}
    if user == nil || user.ID <= 0 || user.Role == nil {
        return result
    }

    for _, role := range strings.Split(*user.Role, ",") {
        for _, permission := range s.permissions[role] {
            key := permission.Resource + ":" + permission.Action
            if !slices.Contains(result, key) {
                result = append(result, key)
            }
        }
    }

    slices.Sort(result)
    return result
}

// DashboardPermissions 合并角色权限与应用菜单别名，供身份查询及兼容接口共享。
func (s *Service) DashboardPermissions(user *User) []string {
    permissions := s.Permissions(user)
    if user != nil && user.ID > 0 && s.config.DashboardPermissions != nil {
        for _, permission := range s.config.DashboardPermissions(user) {
            if !slices.Contains(permissions, permission) {
                permissions = append(permissions, permission)
            }
        }

        slices.Sort(permissions)
    }
    return permissions
}

// Require 是 REST、GraphQL 和连接入口共用的权限门禁。
func (s *Service) Require(ctx context.Context, resource, action string) error {
    user, _ := UserFrom(ctx)
    if !s.Allows(user, resource, action) {
        return &httperr.Error{Code: "FORBIDDEN", Message: "当前账号缺少所需权限"}
    }
    return nil
}

// AuthorizeCurrent 在管理操作前读取真实账号，并复核会话及全部所需动作。
func (s *Service) AuthorizeCurrent(ctx context.Context, resource string, actions ...string) (*User, error) {
    identity, _ := UserFrom(ctx)
    for _, action := range actions {
        if err := s.Require(ctx, resource, action); err != nil {
            return nil, err
        }
    }

    if identity == nil {
        return nil, &httperr.Error{Code: "FORBIDDEN", Message: "操作人身份无效"}
    }
    if err := ValidateConnection(ctx); err != nil {
        return nil, err
    }

    var current User
    if err := s.db.WithContext(ctx).First(&current, identity.ID).Error; err != nil {
        if errors.Is(err, gorm.ErrRecordNotFound) {
            return nil, &httperr.Error{Code: "FORBIDDEN", Message: "当前账号已失效"}
        }
        return nil, &httperr.Error{Code: "SERVICE_UNAVAILABLE", Message: "身份校验暂时不可用"}
    }
    if banned(current, time.Now().UTC()) {
        return nil, &httperr.Error{Code: "FORBIDDEN", Message: "当前账号已失效"}
    }

    for _, action := range actions {
        if !s.Allows(&current, resource, action) {
            return nil, &httperr.Error{Code: "FORBIDDEN", Message: "当前账号缺少所需权限"}
        }
    }

    return &current, nil
}
