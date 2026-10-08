// Package requestmeta 在传输入口与业务层之间传递请求关联元数据。
package requestmeta

import "context"

// RequestMeta 在请求入口生成，只读传递到 Service；首版仅验证传递机制。
// 会话校验接入后使用相同 context 边界传递已经验证的身份。
type RequestMeta struct {
    RequestID, Endpoint string
    Attributes          map[string]string
}

type requestKey struct{}

// WithRequestMeta 将入口生成的请求元数据写入上下文，供日志、审计和业务层关联。
func WithRequestMeta(ctx context.Context, meta RequestMeta) context.Context {
    return context.WithValue(ctx, requestKey{}, meta)
}

// RequestFrom 读取请求元数据及存在标记。
func RequestFrom(ctx context.Context) (RequestMeta, bool) {
    meta, ok := ctx.Value(requestKey{}).(RequestMeta)
    return meta, ok
}
