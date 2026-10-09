// Package service 提供独立于 HTTP 和 GraphQL 的业务样例。
package service

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "context"
    "strings"
    "sync"
    "time"
)

// Error 复用可公开业务错误的统一类型。
type Error = httperr.Error

// Shop 为业务实体，协议 DTO 在适配层映射。
type Shop struct {
    ID                   int
    Name, Slug, Status   string
    CreatedAt, UpdatedAt time.Time
}

// Lookup 描述可选 eq 查询条件，至少一个条件由 Get 校验。
type Lookup struct {
    ID           *int
    Slug, Status *string
}

// Create 描述店铺创建值，空 Status 使用 active 默认值。
type Create struct {
    Name, Slug string
    Status     *string
}

// Shops 仅使用标准 context，后续可由数据库实现替换。
type Shops interface {
    Get(context.Context, Lookup) (*Shop, error)
    Create(context.Context, Create) (*Shop, error)
    List(context.Context, ListQuery) ([]*Shop, error)
}

// Memory 通过读写锁保护内存样例，查询返回实体副本以隔离后续修改。
type Memory struct {
    mu     sync.RWMutex
    rows   map[int]Shop
    nextID int
    now    func() time.Time
}

// NewMemory 注入时钟并创建确定性的 demo 店铺，空时钟使用当前时间。
func NewMemory(now func() time.Time) *Memory {
    if now == nil {
        now = time.Now
    }

    instant := now()
    return &Memory{
        rows: map[int]Shop{1: {
            ID:        1,
            Name:      "示例店铺",
            Slug:      "demo",
            Status:    "active",
            CreatedAt: instant,
            UpdatedAt: instant,
        }},
        nextID: 2,
        now:    now,
    }
}

// Get 按条件交集选取 ID 最小的店铺，查无结果返回 nil, nil。
func (m *Memory) Get(ctx context.Context, where Lookup) (*Shop, error) {
    if err := ctx.Err(); err != nil {
        return nil, err
    }
    if where.ID == nil && where.Slug == nil && where.Status == nil {
        return nil, &Error{Code: "BAD_USER_INPUT", Message: "查询需要至少一个条件"}
    }
    m.mu.RLock()
    defer m.mu.RUnlock()
    // 按 ID 选择首个匹配，保持 POC 内存样例的确定性。
    var result *Shop
    for _, row := range m.rows {
        if where.ID != nil && row.ID != *where.ID {
            continue
        }
        if where.Slug != nil && row.Slug != *where.Slug {
            continue
        }
        if where.Status != nil && row.Status != *where.Status {
            continue
        }
        if result == nil || row.ID < result.ID {
            copy := row
            result = &copy
        }
    }

    return result, nil
}

// Create 校验名称与 slug 后串行创建店铺，原样保存输入并检查 slug 唯一性。
func (m *Memory) Create(ctx context.Context, set Create) (*Shop, error) {
    if err := ctx.Err(); err != nil {
        return nil, err
    }
    if strings.TrimSpace(set.Name) == "" || strings.TrimSpace(set.Slug) == "" {
        return nil, &Error{Code: "BAD_USER_INPUT", Message: "名称和 slug 需要有效内容"}
    }
    m.mu.Lock()
    defer m.mu.Unlock()
    if err := ctx.Err(); err != nil {
        return nil, err
    }

    for _, row := range m.rows {
        if row.Slug == set.Slug {
            return nil, &Error{Code: "BAD_USER_INPUT", Message: "slug 已存在"}
        }
    }

    status := "active"
    if set.Status != nil {
        status = *set.Status
    }

    now := m.now()
    row := Shop{
        ID:        m.nextID,
        Name:      set.Name,
        Slug:      set.Slug,
        Status:    status,
        CreatedAt: now,
        UpdatedAt: now,
    }
    m.nextID++
    m.rows[row.ID] = row
    return &row, nil
}
