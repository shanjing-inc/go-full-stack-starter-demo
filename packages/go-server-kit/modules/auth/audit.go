package auth

import (
    "context"
    "errors"
    "log/slog"
    "strconv"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/requestmeta"
)

// AuditEvent 仅包含固定动作及目标标识，凭据与用户查询条件留在请求内。
type AuditEvent struct {
    ActorID, Resource, Action, Target, Result, RequestID string
    Time                                                 time.Time
}

// AuditSink 接收操作结果审计事件，由应用配置持久化或日志输出方式。
type AuditSink func(context.Context, AuditEvent)

// record 记录成功、失败或权限拒绝的固定动作事件，携带操作人与请求关联标识。
func (s *Service) record(ctx context.Context, resource, action, target string, err error) {
    event := AuditEvent{
        Resource: resource,
        Action:   action,
        Target:   target,
        Result:   "success",
        Time:     time.Now().UTC(),
    }
    if user, ok := UserFrom(ctx); ok && user != nil {
        event.ActorID = strconv.Itoa(user.ID)
    }

    meta, _ := requestmeta.RequestFrom(ctx)
    event.RequestID = meta.RequestID
    if err != nil {
        event.Result = "failed"
        var public *httperr.Error
        if errors.As(err, &public) && public.Code == "FORBIDDEN" {
            event.Result = "denied"
        }
    }
    if s.config.Audit != nil {
        s.config.Audit(ctx, event)
        return
    }
    slog.InfoContext(ctx, "权限与用户操作审计", "actor_id", event.ActorID, "resource", resource,
        "action", action, "target", target, "result", event.Result, "request_id", event.RequestID, "time", event.Time)
}
