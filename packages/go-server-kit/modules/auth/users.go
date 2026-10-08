package auth

import (
    "context"
    "errors"
    "slices"
    "strconv"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "gorm.io/gorm"
    "gorm.io/gorm/clause"
)

// IntCondition 描述整数筛选，各项条件按 AND 组合。
// 指针为 nil 表示省略条件，指向 0 时保留该值参与比较。
type IntCondition struct {
    Eq, Ne, Gt, Gte, Lt, Lte *int

    // 集合最多 100 项；nil 表示省略，空 InArray 匹配零条，空 NotInArray 跳过筛选。
    InArray, NotInArray []int

    // 指针值为 true 时使用对应的空值判断，false 时使用相反判断。
    IsNull, IsNotNull *bool
}

// StringCondition 描述字符串筛选，各项条件按 AND 组合。
// 字符串指针为 nil 表示省略条件，每个字符串值最多 512 字节。
type StringCondition struct {
    Eq, Ne, Gt, Gte, Lt, Lte, Like, NotLike, Ilike, NotIlike *string

    // 集合最多 100 项；nil 表示省略，空 InArray 匹配零条，空 NotInArray 跳过筛选。
    InArray, NotInArray []string

    // 指针值为 true 时使用对应的空值判断，false 时使用相反判断。
    IsNull, IsNotNull *bool
}

// UserFilters 提供协议无关的用户筛选条件，各字段按 AND 组合。
// ID、Email、Role 为 nil 时省略对应筛选；Role 以数据库 role 字符串字段为筛选对象。
// 布尔指针为 nil 时省略条件，显式 false 时保留精确布尔筛选。
type UserFilters struct {
    ID                    *IntCondition
    Email, Role           *StringCondition
    Banned, EmailVerified *bool
}

// UserOrder 描述一个用户排序项，列表中的顺序决定排序优先级。
type UserOrder struct {
    // Field 使用接口字段名：id、name、email、role、createdAt 或 updatedAt。
    Field string

    // Desc 为 true 时降序，为 false 时升序。
    Desc bool
}

// UserListQuery 描述用户列表的筛选、分页和排序参数。
type UserListQuery struct {
    // Where 为空时允许查询全部用户，读取权限由 ListUsers 校验。
    Where UserFilters

    // Limit 允许 0–101，Offset 为非负数；Limit 为 0 时返回空列表并检查上下文状态。
    Limit, Offset int

    // Order 为空时按创建时间降序排列；排序缺少 id 时追加 id 降序保证顺序稳定。
    Order []UserOrder
}

func userInput(message string) error {
    return &httperr.Error{Code: "BAD_USER_INPUT", Message: message}
}

// nullConditions 追加空值判断，field 由调用方的固定字段表提供。
// 显式 false 会反转对应判断，两个参数均有值时按 AND 组合。
func nullConditions(db *gorm.DB, field string, isNull, isNotNull *bool) *gorm.DB {
    for _, item := range []struct {
        value *bool
        null  bool
    }{
        {isNull, true},
        {isNotNull, false},
    } {
        if item.value == nil {
            continue
        }

        null := item.null == *item.value
        operation := " IS NOT NULL"
        if null {
            operation = " IS NULL"
        }

        db = db.Where(field + operation)
    }

    return db
}

// userWhere 将筛选条件转换为参数化查询，字段名和运算符来自固定表。
// 第二个返回值用于判断是否存在有效筛选，供 GetUser 校验空条件。
func userWhere(db *gorm.DB, where UserFilters) (*gorm.DB, int, error) {
    count := 0

    // ID 筛选依次处理标量比较、集合匹配和空值判断。
    if input := where.ID; input != nil {
        for _, item := range []struct {
            value *int
            op    string
        }{
            {input.Eq, "="},
            {input.Ne, "<>"},
            {input.Gt, ">"},
            {input.Gte, ">="},
            {input.Lt, "<"},
            {input.Lte, "<="},
        } {
            if item.value != nil {
                db = db.Where("id "+item.op+" ?", *item.value)
                count++
            }
        }

        for _, item := range []struct {
            values []int
            op     string
        }{
            {input.InArray, "IN"},
            {input.NotInArray, "NOT IN"},
        } {
            if item.values == nil {
                continue
            }
            if len(item.values) > 100 {
                return nil, 0, userInput("条件数组最多 100 项")
            }

            // 空 IN 固定匹配零条；空 NOT IN 跳过筛选，保留其余条件的结果。
            if len(item.values) == 0 {
                if item.op == "NOT IN" {
                    continue
                }
                if item.op == "IN" {
                    db = db.Where("1 = 0")
                }
            } else {
                db = db.Where("id "+item.op+" ?", item.values)
            }
            count++
        }

        db = nullConditions(db, "id", input.IsNull, input.IsNotNull)
        if input.IsNull != nil || input.IsNotNull != nil {
            count++
        }
    }

    // 邮箱与角色共用字符串筛选，SQL 字段名由固定表提供。
    for _, item := range []struct {
        field string
        input *StringCondition
    }{
        {"email", where.Email},
        {"role", where.Role},
    } {
        input := item.input
        if input == nil {
            continue
        }

        for _, match := range []struct {
            value *string
            op    string
        }{
            {input.Eq, "="},
            {input.Ne, "<>"},
            {input.Gt, ">"},
            {input.Gte, ">="},
            {input.Lt, "<"},
            {input.Lte, "<="},
            {input.Like, "LIKE"},
            {input.NotLike, "NOT LIKE"},
            {input.Ilike, "ILIKE"},
            {input.NotIlike, "NOT ILIKE"},
        } {
            if match.value == nil {
                continue
            }
            if len(*match.value) > 512 {
                return nil, 0, userInput("字符串条件最多 512 字节")
            }

            // 使用 LOWER 与 LIKE 表达 ILIKE，保持各方言共用的查询形式。
            if match.op == "ILIKE" || match.op == "NOT ILIKE" {
                operation := "LIKE"
                if match.op == "NOT ILIKE" {
                    operation = "NOT LIKE"
                }

                db = db.Where("LOWER("+item.field+") "+operation+" LOWER(?)", *match.value)
            } else {
                db = db.Where(item.field+" "+match.op+" ?", *match.value)
            }
            count++
        }

        for _, match := range []struct {
            values []string
            op     string
        }{
            {input.InArray, "IN"},
            {input.NotInArray, "NOT IN"},
        } {
            if match.values == nil {
                continue
            }
            if len(match.values) > 100 {
                return nil, 0, userInput("条件数组最多 100 项")
            }

            for _, value := range match.values {
                if len(value) > 512 {
                    return nil, 0, userInput("字符串条件最多 512 字节")
                }
            }

            // 集合筛选与 ID 条件保持相同的空数组语义。
            if len(match.values) == 0 {
                if match.op == "NOT IN" {
                    continue
                }
                if match.op == "IN" {
                    db = db.Where("1 = 0")
                }
            } else {
                db = db.Where(item.field+" "+match.op+" ?", match.values)
            }
            count++
        }

        db = nullConditions(db, item.field, input.IsNull, input.IsNotNull)
        if input.IsNull != nil || input.IsNotNull != nil {
            count++
        }
    }

    // 显式布尔值按等值条件处理，包括 false。
    for _, item := range []struct {
        field string
        value *bool
    }{
        {"banned", where.Banned},
        {"email_verified", where.EmailVerified},
    } {
        if item.value != nil {
            db = db.Where(item.field+" = ?", *item.value)
            count++
        }
    }

    return db, count, nil
}

// CurrentUser 根据上下文中的登录身份读取当前用户，并记录读取审计。
// 身份无效时返回 FORBIDDEN；用户记录已不存在时返回 nil, nil。
func (s *Service) CurrentUser(ctx context.Context) (row *User, err error) {
    user, ok := UserFrom(ctx)
    target := "self"
    if ok && user != nil {
        target = strconv.Itoa(user.ID)
    }
    // 延迟审计在返回时读取命名返回值 err，覆盖校验失败和数据库错误。
    defer func() { s.record(ctx, "user", "get-current", target, err) }()

    if !ok || user == nil || user.ID <= 0 {
        return nil, &httperr.Error{Code: "FORBIDDEN", Message: "请重新登录"}
    }

    var result User
    err = s.db.WithContext(ctx).Take(&result, user.ID).Error
    if errors.Is(err, gorm.ErrRecordNotFound) {
        return nil, nil
    }
    if err != nil {
        return nil, err
    }

    return &result, nil
}

// GetUser 校验 user:get 权限后，按至少一个有效筛选条件查询用户并记录审计。
// 多条记录匹配时返回 ID 最小的记录；查无记录时返回 nil, nil。
func (s *Service) GetUser(ctx context.Context, where UserFilters) (row *User, err error) {
    target := "filtered"
    if where.ID != nil && where.ID.Eq != nil {
        target = strconv.Itoa(*where.ID.Eq)
    }
    // 闭包在返回时读取最终目标和 err，成功查询会将目标更新为实际用户 ID。
    defer func() { s.record(ctx, "user", "get", target, err) }()

    if err = s.Require(ctx, "user", "get"); err != nil {
        return nil, err
    }

    db, count, err := userWhere(s.db.WithContext(ctx), where)
    if err != nil {
        return nil, err
    }
    if count == 0 {
        return nil, userInput("用户查询需要有效筛选条件")
    }

    var result User
    err = db.Order(clause.OrderByColumn{Column: clause.Column{Name: "id"}}).Take(&result).Error
    if errors.Is(err, gorm.ErrRecordNotFound) {
        return nil, nil
    }
    if err != nil {
        return nil, err
    }

    target = strconv.Itoa(result.ID)
    return &result, nil
}

// ListUsers 校验 user:list 权限后，按筛选、分页和排序条件读取用户并记录审计。
// 默认按 createdAt 降序排列，并以 id 排序保证分页顺序稳定。
// 成功查询返回非 nil 切片；Limit 为 0 时返回空切片及 ctx.Err()。
func (s *Service) ListUsers(ctx context.Context, input UserListQuery) (rows []*User, err error) {
    defer func() { s.record(ctx, "user", "list", "collection", err) }()

    if err = s.Require(ctx, "user", "list"); err != nil {
        return nil, err
    }

    // 上限 101 允许分页调用方额外读取一条记录来判断下一页。
    if input.Limit < 0 || input.Limit > 101 || input.Offset < 0 {
        return nil, userInput("limit 需要 0–101，offset 需要大于等于 0")
    }

    // 接口字段映射到固定 SQL 列名，排序方向通过 GORM 子句构造。
    columns := map[string]string{
        "id":        "id",
        "name":      "name",
        "email":     "email",
        "role":      "role",
        "createdAt": "created_at",
        "updatedAt": "updated_at",
    }
    seen := map[string]bool{}
    orders := slices.Clone(input.Order)
    if len(orders) == 0 {
        orders = []UserOrder{{Field: "createdAt", Desc: true}}
    }

    for _, order := range orders {
        if columns[order.Field] == "" || seen[order.Field] {
            return nil, userInput("用户排序字段无效或重复")
        }

        seen[order.Field] = true
    }

    // 相同业务排序值使用唯一 ID 打破平局，避免翻页时顺序漂移。
    if !seen["id"] {
        orders = append(orders, UserOrder{Field: "id", Desc: true})
    }

    db, _, err := userWhere(s.db.WithContext(ctx), input.Where)
    if err != nil {
        return nil, err
    }

    rows = []*User{}
    if input.Limit == 0 {
        return rows, ctx.Err()
    }

    for _, order := range orders {
        db = db.Order(clause.OrderByColumn{Column: clause.Column{Name: columns[order.Field]}, Desc: order.Desc})
    }

    err = db.Limit(input.Limit).Offset(input.Offset).Find(&rows).Error
    return rows, err
}
