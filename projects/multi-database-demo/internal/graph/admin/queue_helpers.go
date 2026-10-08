package admin

import (
    "context"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
)

// queueActor 确认队列依赖就绪并读取当前操作人，统一复核指定队列动作权限。
func (r *Resolver) queueActor(ctx context.Context, actions ...string) (*auth.User, error) {
    if r.Users == nil || r.Queue == nil {
        return nil, &httperr.Error{Code: "SERVICE_UNAVAILABLE", Message: "队列服务暂时不可用"}
    }
    return r.Users.AuthorizeCurrent(ctx, "queue", actions...)
}
