// Package httperr 定义可向客户端公开的业务错误。
package httperr

// Error 携带可公开的业务错误码和消息，传输层通过错误码白名单控制输出。
type Error struct{ Code, Message string }

// Error 返回公开业务消息，满足 Go 错误接口。
func (e *Error) Error() string { return e.Message }

// AllowedCode 判断错误码是否允许通过 REST 或 GraphQL 对外公开。
func AllowedCode(code string) bool {
    switch code {
    case "BAD_USER_INPUT", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "SERVICE_UNAVAILABLE":
        return true
    }

    return false
}
