package graphql

import (
    "context"
    "errors"
    "log/slog"

    gql "github.com/99designs/gqlgen/graphql"
    "github.com/vektah/gqlparser/v2/gqlerror"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/requestmeta"
)

// ErrorPresenter 保留白名单业务错误和请求校验位置，执行期内部异常使用统一消息并记录关联日志。
func ErrorPresenter(logger *slog.Logger) gql.ErrorPresenterFunc {
    return func(ctx context.Context, err error) *gqlerror.Error {
        original := gql.DefaultErrorPresenter(ctx, err)
        out := &gqlerror.Error{
            Message:   original.Message,
            Path:      original.Path,
            Locations: original.Locations,
        }
        var business *httperr.Error
        if errors.As(err, &business) && httperr.AllowedCode(business.Code) {
            out.Message = business.Message
            out.Extensions = map[string]any{"code": business.Code}
        } else if gql.GetFieldContext(ctx) != nil {
            out.Message = "Unexpected error."
            out.Extensions = map[string]any{"code": "INTERNAL_SERVER_ERROR"}
            meta, _ := requestmeta.RequestFrom(ctx)
            logger.ErrorContext(ctx, "GraphQL 操作异常", "request_id", meta.RequestID, "endpoint", meta.Endpoint)
        } else {
            // 解析、校验错误只保留客户端需要的错误码。
            if code, ok := original.Extensions["code"].(string); ok {
                out.Extensions = map[string]any{"code": code}
                if code == "GRAPHQL_VALIDATION_FAILED" && gql.HasOperationContext(ctx) {
                    operation := gql.GetOperationContext(ctx)
                    if operation.Doc != nil && operation.Operation == nil {
                        out.Extensions = map[string]any{"code": "OPERATION_RESOLUTION_FAILURE"}
                    } else if operation.Operation != nil && len(original.Path) > 0 {
                        // Yoga 的变量校验错误保留消息和位置，extensions 为空。
                        out.Extensions = nil
                    }
                }
            }
        }
        return out
    }
}
