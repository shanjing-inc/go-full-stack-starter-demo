package service

import (
    "cmp"
    "context"
    "regexp"
    "slices"
    "strings"
)

// ListQuery 将分页与筛选下沉至存储层。ID 作为排序末项，保证同时间记录的稳定分页。
type ListQuery struct {
    Where         Lookup
    SlugLike      *string
    Limit, Offset int
    Order         []ShopOrder
}

// ShopOrder 描述一个白名单排序字段及其倒序标记。
type ShopOrder struct {
    Field string
    Desc  bool
}

// Validate 校验分页范围及排序字段的白名单和唯一性。
func (q ListQuery) Validate() error {
    if q.Limit < 0 || q.Limit > 101 || q.Offset < 0 {
        return &Error{Code: "BAD_USER_INPUT", Message: "limit 需要 0–101，offset 需要大于等于 0"}
    }

    fields := map[string]bool{
        "id":        true,
        "name":      true,
        "slug":      true,
        "status":    true,
        "createdAt": true,
        "updatedAt": true,
    }
    seen := map[string]bool{}
    for _, order := range q.Order {
        if !fields[order.Field] || seen[order.Field] {
            return &Error{Code: "BAD_USER_INPUT", Message: "排序字段无效或重复"}
        }

        seen[order.Field] = true
    }

    return nil
}

// Orders 返回独立排序切片，默认按创建时间倒序，缺少唯一 ID 时追加 ID 倒序。
func (q ListQuery) Orders() []ShopOrder {
    if len(q.Order) == 0 {
        return []ShopOrder{{Field: "createdAt", Desc: true}, {Field: "id", Desc: true}}
    }

    orders := slices.Clone(q.Order)
    for _, order := range orders {
        if order.Field == "id" {
            return orders
        }
    }

    return append(orders, ShopOrder{Field: "id", Desc: true})
}

// List 在读锁内筛选内存快照、执行稳定排序和分页；零 limit 返回空列表。
func (m *Memory) List(ctx context.Context, q ListQuery) ([]*Shop, error) {
    if err := ctx.Err(); err != nil {
        return nil, err
    }
    if err := q.Validate(); err != nil {
        return nil, err
    }
    m.mu.RLock()
    defer m.mu.RUnlock()
    var pattern *regexp.Regexp
    if q.SlugLike != nil {
        var expression strings.Builder
        expression.WriteString("(?s)^")
        for _, char := range *q.SlugLike {
            switch char {
            case '%':
                expression.WriteString(".*")
            case '_':
                expression.WriteString(".")
            default:
                expression.WriteString(regexp.QuoteMeta(string(char)))
            }
        }

        expression.WriteString("$")
        pattern = regexp.MustCompile(expression.String())
    }

    rows := make([]*Shop, 0)
    for _, row := range m.rows {
        if q.Where.ID != nil && row.ID != *q.Where.ID {
            continue
        }
        if q.Where.Slug != nil && row.Slug != *q.Where.Slug {
            continue
        }
        if q.Where.Status != nil && row.Status != *q.Where.Status {
            continue
        }
        if pattern != nil && !pattern.MatchString(row.Slug) {
            continue
        }

        copy := row
        rows = append(rows, &copy)
    }

    orders := q.Orders()
    slices.SortFunc(rows, func(a, b *Shop) int {
        for _, order := range orders {
            var comparison int
            switch order.Field {
            case "id":
                comparison = cmp.Compare(a.ID, b.ID)
            case "name":
                comparison = strings.Compare(a.Name, b.Name)
            case "slug":
                comparison = strings.Compare(a.Slug, b.Slug)
            case "status":
                comparison = strings.Compare(a.Status, b.Status)
            case "createdAt":
                comparison = a.CreatedAt.Compare(b.CreatedAt)
            case "updatedAt":
                comparison = a.UpdatedAt.Compare(b.UpdatedAt)
            }

            if comparison != 0 {
                if order.Desc {
                    return -comparison
                }
                return comparison
            }
        }

        return 0
    })
    if q.Offset >= len(rows) {
        return []*Shop{}, nil
    }

    rows = rows[q.Offset:]
    if q.Limit < len(rows) {
        rows = rows[:q.Limit]
    }
    if err := ctx.Err(); err != nil {
        return nil, err
    }
    return rows, nil
}
