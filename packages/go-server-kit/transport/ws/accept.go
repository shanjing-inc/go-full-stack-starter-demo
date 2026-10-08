// Package ws 提供来源白名单和帧大小边界；认证由应用在握手前执行。
package ws

import (
    "errors"
    "github.com/coder/websocket"
    "net/http"
)

// ErrOrigin 表示 WebSocket 来源与允许列表不匹配。
var ErrOrigin = errors.New("WebSocket 来源未授权")

// OriginAllowed 按完整来源匹配白名单，空 Origin 沿用公开客户端访问约定。
func OriginAllowed(origin string, allowed []string) bool {
    if origin == "" {
        return true
    }

    for _, v := range allowed {
        if origin == v {
            return true
        }
    }

    return false
}

// Accept 执行应用白名单校验后升级连接并设置读取大小上限，认证由调用方在升级前完成。
func Accept(w http.ResponseWriter, r *http.Request, origins []string, readLimit int64) (*websocket.Conn, error) {
    if !OriginAllowed(r.Header.Get("Origin"), origins) {
        return nil, ErrOrigin
    }
    if readLimit <= 0 {
        return nil, errors.New("WebSocket 帧上限需要正值")
    }

    c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
    if err == nil {
        c.SetReadLimit(readLimit)
    }
    return c, err
}
