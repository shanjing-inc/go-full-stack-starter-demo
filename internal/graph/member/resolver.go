// Package member 将成员端 GraphQL 查询映射到共享店铺服务。
package member

import "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"

// Resolver 通过构造时注入共享业务服务。
type Resolver struct{ Shops service.Shops }
