package model

import (
    "reflect"
    "strconv"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/graph/scalar"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
)

// Lookup 仅实现 业务示例使用的 eq 子集，其余操作符显式返回范围提示。
func (w ShopFilters) Lookup() (service.Lookup, error) {
    var result service.Lookup
    if w.ID != nil {
        if w.ID.Eq == nil || !reflect.DeepEqual(*w.ID, IntFilters{Eq: w.ID.Eq}) {
            return result, unsupportedFilter()
        }

        result.ID = w.ID.Eq
    }

    for _, field := range []struct {
        input  *StringFilters
        target **string
    }{{w.Slug, &result.Slug}, {w.Status, &result.Status}} {
        if field.input == nil {
            continue
        }
        if field.input.Eq == nil || !reflect.DeepEqual(*field.input, StringFilters{Eq: field.input.Eq}) {
            return result, unsupportedFilter()
        }

        *field.target = field.input.Eq
    }

    return result, nil
}

func unsupportedFilter() error {
    return &service.Error{Code: "BAD_USER_INPUT", Message: "当前查询支持 eq 条件"}
}

// FromShop 把业务实体映射为共享 GraphQL DTO，整数 ID 输出为字符串，空实体返回 nil。
func FromShop(row *service.Shop) *ShopItem {
    if row == nil {
        return nil
    }

    id := strconv.Itoa(row.ID)
    created, updated := scalar.DateTime(row.CreatedAt), scalar.DateTime(row.UpdatedAt)
    return &ShopItem{
        ID:        &id,
        Name:      &row.Name,
        Slug:      &row.Slug,
        Status:    &row.Status,
        CreatedAt: &created,
        UpdatedAt: &updated,
    }
}

// ListLookup 保留 eq 筛选，并支持参考列表页的 slug LIKE 条件。
func (w ShopFilters) ListLookup() (service.Lookup, *string, error) {
    var like *string
    if w.Slug != nil {
        copy := *w.Slug
        like = copy.Like
        copy.Like = nil
        if reflect.DeepEqual(copy, StringFilters{}) && like != nil {
            w.Slug = nil
        } else {
            w.Slug = &copy
        }
    }

    lookup, err := w.Lookup()
    return lookup, like, err
}
