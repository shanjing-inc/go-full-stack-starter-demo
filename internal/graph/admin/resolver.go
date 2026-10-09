// Package admin 将后台 GraphQL 操作映射到共享业务、认证和队列服务。
package admin

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    queuerecords "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
)

// Resolver 通过构造时注入共享业务服务。
type Resolver struct {
    Queue *queuerecords.Service
    Shops service.Shops
    Users *auth.Service
}
