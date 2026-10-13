package service

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/model"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/query"
    "context"
    "errors"
    "gorm.io/gen/field"
    "gorm.io/gorm"
    "strings"
    "unicode/utf8"
)

// Database 使用 GORM 生成查询实现店铺服务，借用应用连接池。
type Database struct{ query *query.Query }

// NewDatabase 基于应用数据库装配类型化查询对象。
func NewDatabase(db *gorm.DB) *Database { return &Database{query: query.Use(db)} }

func shopEntity(row *model.Shop) *Shop {
    if row == nil {
        return nil
    }
    return &Shop{
        ID:        row.ID,
        Name:      row.Name,
        Slug:      row.Slug,
        Status:    row.Status,
        CreatedAt: row.CreatedAt,
        UpdatedAt: row.UpdatedAt,
    }
}

// Get 只投影业务字段并按 ID 选取首个匹配，记录缺失返回 nil, nil。
func (s *Database) Get(ctx context.Context, where Lookup) (*Shop, error) {
    if where.ID == nil && where.Slug == nil && where.Status == nil {
        return nil, &Error{Code: "BAD_USER_INPUT", Message: "查询需要至少一个条件"}
    }

    table := s.query.Shop
    q := table.WithContext(ctx).Select(table.ID, table.Name, table.Slug, table.Status, table.CreatedAt, table.UpdatedAt)
    if where.ID != nil {
        q = q.Where(table.ID.Eq(*where.ID))
    }
    if where.Slug != nil {
        q = q.Where(table.Slug.Eq(*where.Slug))
    }
    if where.Status != nil {
        q = q.Where(table.Status.Eq(*where.Status))
    }

    row, err := q.Order(table.ID).First()
    if errors.Is(err, gorm.ErrRecordNotFound) {
        return nil, nil
    }
    if err != nil {
        return nil, err
    }
    return shopEntity(row), nil
}

// Create 归整名称和 slug，按字符数与状态白名单校验，唯一冲突映射为公开输入错误。
func (s *Database) Create(ctx context.Context, set Create) (*Shop, error) {
    name, slug := strings.TrimSpace(set.Name), strings.TrimSpace(set.Slug)
    if name == "" || slug == "" || utf8.RuneCountInString(name) > 255 || utf8.RuneCountInString(slug) > 255 {
        return nil, &Error{Code: "BAD_USER_INPUT", Message: "名称和 slug 需要 1–255 个字符"}
    }

    status := "active"
    if set.Status != nil {
        status = *set.Status
    }
    if status != "active" && status != "inactive" {
        return nil, &Error{Code: "BAD_USER_INPUT", Message: "状态需要 active 或 inactive"}
    }

    row := model.Shop{Name: name, Slug: slug, Status: status}
    if err := s.query.Shop.WithContext(ctx).Create(&row); err != nil {
        if database.IsDuplicate(err) {
            return nil, &Error{Code: "BAD_USER_INPUT", Message: "slug 已存在"}
        }
        return nil, err
    }
    return shopEntity(&row), nil
}

// List 按白名单排序和参数化条件执行数据库分页，零 limit 在 SQL 前返回空列表。
func (s *Database) List(ctx context.Context, input ListQuery) ([]*Shop, error) {
    if err := ctx.Err(); err != nil {
        return nil, err
    }
    if err := input.Validate(); err != nil {
        return nil, err
    }
    // GORM 的 Limit(0) 会取消限制，零条请求在执行 SQL 前返回。
    if input.Limit == 0 {
        return []*Shop{}, nil
    }

    table := s.query.Shop
    q := table.WithContext(ctx).Select(table.ID, table.Name, table.Slug, table.Status, table.CreatedAt, table.UpdatedAt)
    if input.Where.ID != nil {
        q = q.Where(table.ID.Eq(*input.Where.ID))
    }
    if input.Where.Slug != nil {
        q = q.Where(table.Slug.Eq(*input.Where.Slug))
    }
    if input.Where.Status != nil {
        q = q.Where(table.Status.Eq(*input.Where.Status))
    }
    if input.SlugLike != nil {
        q = q.Where(table.Slug.Like(*input.SlugLike))
    }

    fields := map[string]field.OrderExpr{
        "id":        table.ID,
        "name":      table.Name,
        "slug":      table.Slug,
        "status":    table.Status,
        "createdAt": table.CreatedAt,
        "updatedAt": table.UpdatedAt,
    }
    for _, order := range input.Orders() {
        column := fields[order.Field]
        if order.Desc {
            q = q.Order(column.Desc())
        } else {
            q = q.Order(column.Asc())
        }
    }

    found, err := q.Limit(input.Limit).Offset(input.Offset).Find()
    if err != nil {
        return nil, err
    }

    rows := make([]*Shop, 0, len(found))
    for _, row := range found {
        rows = append(rows, shopEntity(row))
    }

    return rows, nil
}
