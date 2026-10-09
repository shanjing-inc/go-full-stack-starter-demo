// Package model 定义多个 GraphQL 端点共用的协议 DTO。
package model

import "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/graph/scalar"

// IntFilters 保留 Schema 的整数筛选形态，支持的操作子集由具体适配入口校验。
type IntFilters struct {
    Eq         *int  `json:"eq,omitempty"`
    Gt         *int  `json:"gt,omitempty"`
    Gte        *int  `json:"gte,omitempty"`
    InArray    []int `json:"inArray,omitempty"`
    IsNotNull  *bool `json:"isNotNull,omitempty"`
    IsNull     *bool `json:"isNull,omitempty"`
    Lt         *int  `json:"lt,omitempty"`
    Lte        *int  `json:"lte,omitempty"`
    Ne         *int  `json:"ne,omitempty"`
    NotInArray []int `json:"notInArray,omitempty"`
}

// ShopFilters 组合可选店铺 ID、slug 和状态条件，已提供条件按交集查询。
type ShopFilters struct {
    ID     *IntFilters    `json:"id,omitempty"`
    Slug   *StringFilters `json:"slug,omitempty"`
    Status *StringFilters `json:"status,omitempty"`
}

// ShopItem 表示两端共享的可空店铺输出字段，日期由 DateTime 标量序列化。
type ShopItem struct {
    CreatedAt *scalar.DateTime `json:"createdAt,omitempty"`
    ID        *string          `json:"id,omitempty"`
    Name      *string          `json:"name,omitempty"`
    Slug      *string          `json:"slug,omitempty"`
    Status    *string          `json:"status,omitempty"`
    UpdatedAt *scalar.DateTime `json:"updatedAt,omitempty"`
}

// StringFilters 保留字符串操作符及可选值，查询入口分别校验 eq 与列表 LIKE 支持范围。
type StringFilters struct {
    Eq         *string  `json:"eq,omitempty"`
    Gt         *string  `json:"gt,omitempty"`
    Gte        *string  `json:"gte,omitempty"`
    Ilike      *string  `json:"ilike,omitempty"`
    InArray    []string `json:"inArray,omitempty"`
    IsNotNull  *bool    `json:"isNotNull,omitempty"`
    IsNull     *bool    `json:"isNull,omitempty"`
    Like       *string  `json:"like,omitempty"`
    Lt         *string  `json:"lt,omitempty"`
    Lte        *string  `json:"lte,omitempty"`
    Ne         *string  `json:"ne,omitempty"`
    NotIlike   *string  `json:"notIlike,omitempty"`
    NotInArray []string `json:"notInArray,omitempty"`
    NotLike    *string  `json:"notLike,omitempty"`
}
