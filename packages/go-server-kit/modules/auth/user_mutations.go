package auth

import (
    "context"
    "errors"
    "slices"
    "strconv"
    "strings"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "gorm.io/gorm"
    "gorm.io/gorm/clause"
)

// Optional 保留协议输入中省略与显式 null 的区别。
// Set 为 false 时省略字段；为 true 时，Value 为 nil 表示清空，有值表示赋值。
type Optional[T any] struct {
    Set   bool
    Value *T
}

// CreateUserInput 描述管理端创建用户的输入，Role 为 nil 时使用 user 角色。
// 名称去除首尾空白后为 1–255 字节；密码为 8–128 字节，邮箱由服务规范化。
type CreateUserInput struct {
    Name, Email, Password string
    Role                  *string
}

// UpdateUserInput 描述批量更新字段，普通指针为 nil 时省略对应修改。
// BanReason、BanExpires 通过 Optional 表达保留、赋值和清空；Banned 为 false 时清空封禁信息。
type UpdateUserInput struct {
    Name, Role *string
    Banned     *bool

    BanReason  Optional[string]
    BanExpires Optional[time.Time]
}

func forbiddenMutation(message string) error {
    return &httperr.Error{Code: "FORBIDDEN", Message: message}
}

// lockAdministration 与初始化共享单例写锁，多个实例按同一顺序执行用户管理事务。
func lockAdministration(tx *gorm.DB) error {
    result := tx.Model(&Bootstrap{}).Where("id = 1").UpdateColumn("revision", gorm.Expr("revision + 1"))
    if result.Error != nil {
        return result.Error
    }
    if result.RowsAffected != 1 {
        return errors.New("初始化锁行缺失，请执行迁移")
    }
    return nil
}

// mutationActor 在事务内锁定并重读操作人，复核有效封禁状态和全部动作权限。
// 上下文身份用于定位账号，权限判断使用数据库中的最新用户记录。
func (s *Service) mutationActor(ctx context.Context, tx *gorm.DB, actions ...Permission) (*User, error) {
    identity, ok := UserFrom(ctx)
    if !ok || identity == nil || identity.ID <= 0 {
        return nil, forbiddenMutation("请重新登录")
    }

    var actor User
    err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&actor, identity.ID).Error
    if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && banned(actor, time.Now().UTC()) {
        return nil, forbiddenMutation("当前账号已失效")
    }
    if err != nil {
        return nil, err
    }

    for _, p := range actions {
        if !s.Allows(&actor, p.Resource, p.Action) {
            return nil, forbiddenMutation("当前账号缺少所需权限")
        }
    }

    return &actor, nil
}

// permittedRole 校验并规范化逗号分隔的角色，排序去重后限制为 255 字节。
// 目标权限须包含于操作人的授权集合；含 owner 角色或 system:owner 权限时返回 FORBIDDEN。
func (s *Service) permittedRole(actor *User, role string) (string, error) {
    values := strings.Split(role, ",")
    for i, value := range values {
        values[i] = strings.TrimSpace(value)
        if _, ok := s.permissions[values[i]]; !ok || values[i] == "" {
            return "", userInput("角色无效")
        }
    }

    // 固定角色串的顺序，供存储和后续变更比较复用。
    slices.Sort(values)
    values = slices.Compact(values)
    role = strings.Join(values, ",")
    if len(role) > 255 {
        return "", userInput("角色长度最多 255 字节")
    }

    candidate := &User{ID: 1, Role: &role}
    if HasRole(candidate, "owner") || s.Allows(candidate, "system", "owner") {
        return "", forbiddenMutation("owner 角色通过所有权转移设置")
    }

    for _, permission := range s.Permissions(candidate) {
        if !slices.Contains(s.Permissions(actor), permission) {
            return "", forbiddenMutation("目标角色超出当前账号授权范围")
        }
    }

    return role, nil
}

// canManage 校验目标权限是否包含于操作人的授权集合。
// 管理带 owner 角色或 system:owner 权限的目标，还要求操作人同时拥有这两项资格。
func (s *Service) canManage(actor, target *User) error {
    isOwner := HasRole(target, "owner") || s.Allows(target, "system", "owner")
    if isOwner && !(HasRole(actor, "owner") && s.Allows(actor, "system", "owner")) {
        return forbiddenMutation("owner 用户由 owner 管理")
    }

    for _, permission := range s.Permissions(target) {
        if !slices.Contains(s.Permissions(actor), permission) {
            return forbiddenMutation("目标账号超出当前账号授权范围")
        }
    }

    return nil
}

// mutationDatabaseError 将数据库唯一约束冲突转换为公开的邮箱重复错误。
func mutationDatabaseError(err error) error {
    if database.IsDuplicate(err) {
        return userInput("邮箱已存在")
    }

    return err
}

// CreateUser 校验 user:create 权限后，在同一事务中创建用户和密码登录账号。
// 非 user 角色还要求 user:set-role 权限；事务内重新读取操作人并复核目标角色。
// 返回时记录创建审计，成功后审计目标更新为新用户 ID。
func (s *Service) CreateUser(ctx context.Context, input CreateUserInput) (row *User, err error) {
    target := ""
    defer func() { s.record(ctx, "user", "create", target, err) }()

    if err = s.Require(ctx, "user", "create"); err != nil {
        return nil, err
    }

    name := strings.TrimSpace(input.Name)
    if name == "" || len(name) > 255 {
        return nil, userInput("名称长度需要 1–255 字节")
    }

    email, e := emailValue(input.Email)
    if e != nil {
        return nil, userInput("邮箱格式无效")
    }
    if len(input.Password) < 8 || len(input.Password) > 128 {
        return nil, userInput("密码长度需要 8–128 字节")
    }

    role := "user"
    if input.Role != nil {
        role = *input.Role
    }

    // 在密码派生前验证角色，事务内复核最新权限。
    actor, _ := UserFrom(ctx)
    role, err = s.permittedRole(actor, role)
    if err != nil {
        return nil, err
    }

    hash, e := PasswordHash(input.Password)
    if e != nil {
        return nil, e
    }

    row = &User{
        Name:  name,
        Email: email,
        Role:  &role,
    }

    err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
        if e := lockAdministration(tx); e != nil {
            return e
        }

        actions := []Permission{{"user", "create"}}
        if role != "user" {
            actions = append(actions, Permission{"user", "set-role"})
        }

        current, e := s.mutationActor(ctx, tx, actions...)
        if e != nil {
            return e
        }
        if _, e = s.permittedRole(current, role); e != nil {
            return e
        }

        // 用户与 credential 账号一起提交，任一写入失败均回滚。
        if e = tx.Create(row).Error; e != nil {
            return mutationDatabaseError(e)
        }
        return tx.Create(&Account{
            UserID:     row.ID,
            AccountID:  strconv.Itoa(row.ID),
            ProviderID: "credential",
            Password:   &hash,
        }).Error
    })
    if err != nil {
        return nil, err
    }

    target = strconv.Itoa(row.ID)
    return row, nil
}

// updates 构造字段更新表，保留显式 false 和 null，空输入返回 BAD_USER_INPUT。
// 名称和封禁原因按字节校验，指定到期时间须晚于当前时间，更新时间截断到秒。
func (input UpdateUserInput) updates() (map[string]any, error) {
    set := map[string]any{}
    if input.Name != nil {
        name := strings.TrimSpace(*input.Name)
        if name == "" || len(name) > 255 {
            return nil, userInput("名称长度需要 1–255 字节")
        }

        set["name"] = name
    }
    if input.Role != nil {
        set["role"] = *input.Role
    }
    if input.Banned != nil {
        set["banned"] = *input.Banned
    }

    // Optional.Set 保留显式 null，使调用方能够清空可空字段。
    if input.BanReason.Set {
        if input.BanReason.Value != nil && len(*input.BanReason.Value) > 1000 {
            return nil, userInput("封禁原因最多 1000 字节")
        }

        set["ban_reason"] = input.BanReason.Value
    }
    if input.BanExpires.Set {
        if input.BanExpires.Value != nil && !input.BanExpires.Value.After(time.Now().UTC()) {
            return nil, userInput("封禁到期时间需要晚于当前时间")
        }

        set["ban_expires"] = input.BanExpires.Value
    }

    if len(set) == 0 {
        return nil, userInput("至少提供一个更新字段")
    }

    // 解除封禁时同时清空原因和到期时间。
    if input.Banned != nil && !*input.Banned {
        set["ban_reason"] = nil
        set["ban_expires"] = nil
    }

    set["updated_at"] = time.Now().UTC().Truncate(time.Second)
    return set, nil
}

// UpdateUsers 按输入字段校验更新、角色和封禁权限，在事务中批量修改用户。
// 筛选须包含有效条件，最多匹配 100 个用户；成功时按 ID 升序返回，零匹配返回空切片。
// 事务内复核目标管理权限、自身变更限制与现有 owner 可用性，按变更内容撤销目标会话。
// 返回时记录更新审计，并按输入字段追加角色与封禁审计。
func (s *Service) UpdateUsers(ctx context.Context, where UserFilters, input UpdateUserInput) (rows []*User, err error) {
    target := ""
    defer func() {
        s.record(ctx, "user", "update", target, err)
        if input.Role != nil {
            s.record(ctx, "user", "set-role", target, err)
        }
        if input.Banned != nil || input.BanReason.Set || input.BanExpires.Set {
            s.record(ctx, "user", "ban", target, err)
        }
    }()

    // 分别收集字段所需的权限，空输入也先执行通用更新门禁。
    actions := []Permission{}
    if input.Name != nil {
        actions = append(actions, Permission{"user", "update"})
    }
    if input.Role != nil {
        actions = append(actions, Permission{"user", "set-role"})
    }
    if input.Banned != nil || input.BanReason.Set || input.BanExpires.Set {
        actions = append(actions, Permission{"user", "ban"})
    }
    if len(actions) == 0 {
        actions = append(actions, Permission{"user", "update"})
    }

    for _, p := range actions {
        if err = s.Require(ctx, p.Resource, p.Action); err != nil {
            return nil, err
        }
    }

    set, err := input.updates()
    if err != nil {
        return nil, err
    }

    err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
        if e := lockAdministration(tx); e != nil {
            return e
        }

        actor, e := s.mutationActor(ctx, tx, actions...)
        if e != nil {
            return e
        }
        if input.Role != nil {
            role, e := s.permittedRole(actor, *input.Role)
            if e != nil {
                return e
            }

            set["role"] = role
        }

        query, count, e := userWhere(tx.Model(&User{}), where)
        if e != nil {
            return e
        }
        if count == 0 {
            return userInput("更新操作需要明确的筛选条件")
        }

        // 多取一条检测批量上限，锁定目标后统一校验再写入。
        rows = []*User{}
        if e = query.Clauses(clause.Locking{Strength: "UPDATE"}).Order("id ASC").Limit(101).Find(&rows).Error; e != nil {
            return e
        }
        if len(rows) > 100 {
            return userInput("单次最多更新 100 个用户")
        }

        ids, auditIDs := []int{}, []string{}
        for _, row := range rows {
            ids = append(ids, row.ID)
            auditIDs = append(auditIDs, strconv.Itoa(row.ID))
        }

        target = strings.Join(auditIDs, ",")

        // 每个目标都须满足管理权限，并保留操作人的角色和登录能力。
        for _, row := range rows {
            if e = s.canManage(actor, row); e != nil {
                return e
            }
            if input.Role != nil && row.Role != nil && *row.Role != set["role"] && row.ID == actor.ID {
                return forbiddenMutation("当前账号保留自身角色，owner 变更通过所有权转移执行")
            }
            if input.Role != nil && HasRole(row, "owner") {
                return forbiddenMutation("owner 角色变更通过所有权转移执行")
            }

            candidate := *row
            if input.Banned != nil {
                candidate.Banned = input.Banned
            }
            if input.BanExpires.Set {
                candidate.BanExpires = input.BanExpires.Value
            }
            if row.ID == actor.ID && banned(candidate, time.Now().UTC()) {
                return forbiddenMutation("当前账号保留自身登录能力")
            }
        }

        if len(ids) == 0 {
            return nil
        }
        if e = tx.Model(&User{}).Where("id IN ?", ids).Updates(set).Error; e != nil {
            return e
        }

        // 检查全部 owner 的有效封禁状态，单例写锁保护跨实例并发。
        if input.Banned != nil || input.BanExpires.Set {
            var owners []User
            if e = tx.Where("role = ? OR role LIKE ? OR role LIKE ? OR role LIKE ?", "owner", "owner,%", "%,owner", "%,owner,%").Find(&owners).Error; e != nil {
                return e
            }

            hasOwner, available := false, false
            for _, owner := range owners {
                if HasRole(&owner, "owner") {
                    hasOwner = true
                    if !banned(owner, time.Now().UTC()) {
                        available = true
                    }
                }
            }

            if hasOwner && !available {
                return forbiddenMutation("至少保留一位可用 owner")
            }
        }

        // 角色改变、显式封禁及已封禁账号的到期时间变更触发会话撤销。
        revoke := []int{}
        for _, row := range rows {
            roleChanged := input.Role != nil && (row.Role == nil || *row.Role != set["role"])
            if roleChanged || input.Banned != nil && *input.Banned || input.BanExpires.Set && row.Banned != nil && *row.Banned {
                revoke = append(revoke, row.ID)
            }
        }

        if len(revoke) > 0 {
            if e = tx.Where("user_id IN ?", revoke).Delete(&Session{}).Error; e != nil {
                return e
            }
        }

        // 事务内重读已写入的字段，返回值保持 ID 升序。
        return tx.Where("id IN ?", ids).Order("id ASC").Find(&rows).Error
    })
    if err != nil {
        return nil, err
    }

    return rows, nil
}

// RevokeUserSessions 校验 session:revoke 权限，撤销指定用户的全部会话并记录审计。
// userID 须为正整数；事务内复核操作人和目标管理权限，用户缺失返回 BAD_USER_INPUT。
func (s *Service) RevokeUserSessions(ctx context.Context, userID int) (err error) {
    defer func() { s.record(ctx, "session", "revoke", strconv.Itoa(userID), err) }()

    if err = s.Require(ctx, "session", "revoke"); err != nil {
        return err
    }
    if userID <= 0 {
        return userInput("用户 ID 需要正整数")
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

        return tx.Where("user_id = ?", userID).Delete(&Session{}).Error
    })
}
