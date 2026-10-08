package service

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/requestmeta"
    "context"
)

// RequestMeta 保留兼容回归样本使用的应用级探针。
type RequestMeta struct{ RequestID, Endpoint, ProbeHeader, ProbeCookie string }

// WithRequestMeta 把应用兼容探针映射到公共请求元数据上下文。
func WithRequestMeta(ctx context.Context, meta RequestMeta) context.Context {
    return requestmeta.WithRequestMeta(ctx, requestmeta.RequestMeta{
        RequestID:  meta.RequestID,
        Endpoint:   meta.Endpoint,
        Attributes: map[string]string{"probeHeader": meta.ProbeHeader, "probeCookie": meta.ProbeCookie},
    })
}

// RequestFrom 读取公共元数据并恢复应用级探针字段。
func RequestFrom(ctx context.Context) (RequestMeta, bool) {
    meta, ok := requestmeta.RequestFrom(ctx)
    return RequestMeta{
        meta.RequestID,
        meta.Endpoint,
        meta.Attributes["probeHeader"],
        meta.Attributes["probeCookie"],
    }, ok
}
