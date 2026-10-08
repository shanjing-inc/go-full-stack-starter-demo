package auth

import (
    "context"
    "slices"
    "time"
)

type connectionKey struct{}

// ValidateConnection 供长连接发送、接收及空闲检查复用握手时的认证门禁。
// 公开样例入口保持原有行为；Guard 保护的入口会携带数据库复核函数。
func ValidateConnection(ctx context.Context) error {
    if validate, ok := ctx.Value(connectionKey{}).(func(context.Context) error); ok {
        return validate(ctx)
    }
    return nil
}

// connectionContext 保存握手时的角色和权限快照，以三秒数据库复核检查会话与授权变化。
func (s *Service) connectionContext(ctx context.Context, token string, user *User) context.Context {
    permissions := s.DashboardPermissions(user)
    role := ""
    if user.Role != nil {
        role = *user.Role
    }

    validate := func(parent context.Context) error {
        check, cancel := context.WithTimeout(parent, 3*time.Second)
        defer cancel()
        _, current, err := s.resolve(check, token, false)
        if err != nil {
            return err
        }

        currentRole := ""
        if current.Role != nil {
            currentRole = *current.Role
        }
        // 角色或有效权限变更后重新握手，清除连接中已有的授权快照。
        if current.ID != user.ID || currentRole != role || !slices.Equal(permissions, s.DashboardPermissions(current)) {
            return ErrUnauthorized
        }
        return nil
    }
    return context.WithValue(WithUser(ctx, user), connectionKey{}, validate)
}
