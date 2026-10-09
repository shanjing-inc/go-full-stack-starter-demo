// Package model 由应用组合公共模型和业务模型。
package model

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    "time"
)

// Shop 保持既有 Shop API 的整数 ID、字符串状态与时间字段。
// ID 采用兼容接口的有符号 bigint；现有表导入需先对照真实库快照。
type Shop struct {
    ID        int       `gorm:"column:id;size:64;primaryKey;autoIncrement;comment:店铺编号"`
    Name      string    `gorm:"column:name;type:varchar(255);not null;comment:店铺名称"`
    Slug      string    `gorm:"column:slug;type:varchar(255);not null;uniqueIndex:uk_slug;comment:店铺唯一标识"`
    Status    string    `gorm:"column:status;type:varchar(32);not null;default:active;index:idx_status;comment:状态 active 或 inactive"`
    CreatedAt time.Time `gorm:"column:created_at;precision:0;not null;comment:创建时间"`
    UpdatedAt time.Time `gorm:"column:updated_at;precision:0;not null;comment:更新时间"`
}

// TableName 固定使用 shop 表名。
func (Shop) TableName() string { return "shop" }

// Models 组合店铺与认证模型，作为 Schema 导出及查询代码生成的共同来源。
func Models() []any { return append(auth.Models(), &Shop{}) }
