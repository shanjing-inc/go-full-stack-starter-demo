// Package stream 以 Go ResponseController 实现逐条刷新、写期限与取消友好的 SSE。
package stream

import (
    "encoding/json"
    "errors"
    "fmt"
    "net/http"
    "strings"
    "time"
)

// Writer 封装 SSE 输出、逐条刷新和有界写入期限。
type Writer struct {
    output     http.ResponseWriter
    controller *http.ResponseController
    timeout    time.Duration
}

// New 验证写期限支持并提交 SSE 响应头，后续错误由流生命周期处理。
func New(w http.ResponseWriter, timeout time.Duration) (*Writer, error) {
    if timeout <= 0 {
        return nil, errors.New("流写入期限需要正数")
    }

    controller := http.NewResponseController(w)
    if err := controller.SetWriteDeadline(time.Now().Add(timeout)); err != nil {
        return nil, errors.New("当前 HTTP 连接缺少流写入期限支持")
    }
    w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
    w.Header().Set("Cache-Control", "no-cache, no-transform")
    w.Header().Set("X-Accel-Buffering", "no")
    w.WriteHeader(http.StatusOK)
    return &Writer{output: w, controller: controller, timeout: timeout}, nil
}

// write 为当前消息设置期限并刷新，成功后清除期限以等待下一条消息。
func (s *Writer) write(text string) error {
    if err := s.controller.SetWriteDeadline(time.Now().Add(s.timeout)); err != nil {
        return err
    }
    if _, err := fmt.Fprint(s.output, text); err != nil {
        return err
    }
    if err := s.controller.Flush(); err != nil {
        return err
    }
    // 下次消息到来前清除旧期限；每次实际写入重新设置有界期限。
    return s.controller.SetWriteDeadline(time.Time{})
}

// Event 把值编码为 JSON 后发送命名事件，事件名接受单行非空文本。
func (s *Writer) Event(name string, value any) error {
    if name == "" || strings.ContainsAny(name, "\r\n") {
        return errors.New("事件名称无效")
    }

    data, err := json.Marshal(value)
    if err != nil {
        return err
    }
    return s.write("event: " + name + "\ndata: " + string(data) + "\n\n")
}

// Heartbeat 发送 SSE 注释心跳并刷新连接。
func (s *Writer) Heartbeat() error { return s.write(": ping\n\n") }
