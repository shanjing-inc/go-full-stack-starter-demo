package admin

import (
    "cmp"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/graph/model"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/graph/scalar"
    "slices"
    "strconv"
    "time"
)

// usersReady 校验 Resolver 的用户服务依赖，缺失时返回受控的服务不可用错误。
func (r *Resolver) usersReady() error {
    if r.Users == nil {
        return &httperr.Error{Code: "SERVICE_UNAVAILABLE", Message: "用户服务暂时不可用"}
    }

    return nil
}

// userDate 将时间值包装为可空 DateTime 指针，供用户投影复用。
func userDate(value time.Time) *scalar.DateTime {
    result := scalar.DateTime(value)
    return &result
}

// fromUser 将用户模型映射为 GraphQL 返回值，保留可空字段和查无记录的 nil。
// 数据库整数 ID 转为 GraphQL 字符串 ID，时间字段交给 DateTime 标量序列化。
func fromUser(row *auth.User) *UserItem {
    if row == nil {
        return nil
    }

    id := strconv.Itoa(row.ID)
    result := &UserItem{
        ID:            &id,
        Name:          &row.Name,
        Email:         &row.Email,
        EmailVerified: &row.EmailVerified,
        Image:         row.Image,
        Role:          row.Role,
        Banned:        row.Banned,
        BanReason:     row.BanReason,
        CreatedAt:     userDate(row.CreatedAt),
        UpdatedAt:     userDate(row.UpdatedAt),
    }
    if row.BanExpires != nil {
        result.BanExpires = userDate(*row.BanExpires)
    }

    return result
}

// userString 将 GraphQL 字符串条件映射为公共 DTO，保留指针和集合的可选语义。
func userString(input *model.StringFilters) *auth.StringCondition {
    if input == nil {
        return nil
    }

    return &auth.StringCondition{
        Eq:         input.Eq,
        Ne:         input.Ne,
        Gt:         input.Gt,
        Gte:        input.Gte,
        Lt:         input.Lt,
        Lte:        input.Lte,
        Like:       input.Like,
        NotLike:    input.NotLike,
        Ilike:      input.Ilike,
        NotIlike:   input.NotIlike,
        InArray:    input.InArray,
        NotInArray: input.NotInArray,
        IsNull:     input.IsNull,
        IsNotNull:  input.IsNotNull,
    }
}

// userFilters 将 GraphQL 用户筛选映射为公共 DTO，nil 输入对应空筛选。
// 条件值直接传递，保留显式 false、空数组和空值判断的含义。
func userFilters(input *UserFilters) auth.UserFilters {
    if input == nil {
        return auth.UserFilters{}
    }

    result := auth.UserFilters{
        Email:         userString(input.Email),
        Role:          userString(input.Role),
        Banned:        input.Banned,
        EmailVerified: input.EmailVerified,
    }
    if i := input.ID; i != nil {
        result.ID = &auth.IntCondition{
            Eq:         i.Eq,
            Ne:         i.Ne,
            Gt:         i.Gt,
            Gte:        i.Gte,
            Lt:         i.Lt,
            Lte:        i.Lte,
            InArray:    i.InArray,
            NotInArray: i.NotInArray,
            IsNull:     i.IsNull,
            IsNotNull:  i.IsNotNull,
        }
    }

    return result
}

// userOrders 将按字段组织的 GraphQL 排序转换为按优先级排列的公共排序列表。
// priority 为正整数，数值越小越优先；相同优先级保持字段收集顺序。
// nil 输入返回 nil，由用户服务应用默认排序并补充 ID 排序。
func userOrders(input *UserOrderBy) ([]auth.UserOrder, error) {
    if input == nil {
        return nil, nil
    }

    type ordered struct {
        order    auth.UserOrder
        priority int
    }

    // 按固定顺序收集排序字段，使相同 priority 的排序结果可预测。
    values := []ordered{}
    for _, entry := range []struct {
        field string
        value *InnerOrder
    }{
        {"createdAt", input.CreatedAt},
        {"email", input.Email},
        {"id", input.ID},
        {"name", input.Name},
        {"role", input.Role},
        {"updatedAt", input.UpdatedAt},
    } {
        if entry.value == nil {
            continue
        }
        if entry.value.Priority < 1 {
            return nil, &httperr.Error{Code: "BAD_USER_INPUT", Message: "排序 priority 需要大于等于 1"}
        }

        values = append(values, ordered{
            auth.UserOrder{Field: entry.field, Desc: entry.value.Direction == OrderDirectionDesc},
            entry.value.Priority,
        })
    }

    slices.SortStableFunc(values, func(a, b ordered) int { return cmp.Compare(a.priority, b.priority) })

    result := []auth.UserOrder{}
    for _, item := range values {
        result = append(result, item.order)
    }

    return result, nil
}
