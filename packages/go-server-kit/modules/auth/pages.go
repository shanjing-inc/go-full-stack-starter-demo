package auth

import (
    "context"
    "time"

    "github.com/labstack/echo/v5"
)

// AuthenticatePage 为 SSR 页面复用签名 Cookie、Bearer、来源及有效会话校验。
// 调用方根据返回错误渲染页面提示，并按页面职责校验权限。
func (s *Service) AuthenticatePage(c *echo.Context) error {
    request := c.Request()
    token, cookie := s.requestToken(request)
    if !s.originOK(request, cookie) {
        return ErrUnauthorized
    }

    check, cancel := context.WithTimeout(request.Context(), 3*time.Second)
    session, user, err := s.Resolve(check, token)
    cancel()
    if err != nil {
        return err
    }
    if cookie {
        s.cookie(c, session)
    }

    ctx := context.WithValue(request.Context(), sessionIDKey{}, session.ID)
    c.SetRequest(request.WithContext(s.connectionContext(ctx, token, user)))
    return nil
}
