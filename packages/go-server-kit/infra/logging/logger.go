// Package logging 构建 JSON 结构化日志。
package logging

import (
    "io"
    "log/slog"
)

// New 按指定最低日志级别构造 JSON 日志器，输出流生命周期由调用方管理。
func New(out io.Writer, level slog.Level) *slog.Logger {
    return slog.New(slog.NewJSONHandler(out, &slog.HandlerOptions{Level: level}))
}
