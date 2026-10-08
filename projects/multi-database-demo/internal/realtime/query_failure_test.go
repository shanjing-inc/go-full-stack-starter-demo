package server

// 本文件覆盖查询失败与期限同时发生时的终止结果优先级。

import (
    "context"
    "testing"
    "time"
)

func TestQueryFailureDeadlinePriority(t *testing.T) {
    active := context.Background()
    expired, finish := context.WithDeadline(active, time.Now().Add(-time.Second))
    defer finish()
    canceled, cancel := context.WithCancel(active)
    cancel()
    for _, item := range []struct {
        name                    string
        query, parent           context.Context
        code, fallback, message string
    }{
        {
            "真实Bus故障",
            active,
            active,
            "BUS_UNAVAILABLE",
            "Bus 暂时不可用。",
            "Bus 暂时不可用。",
        },
        {
            "订阅中断保留协议消息",
            active,
            active,
            "BUS_UNAVAILABLE",
            "Bus 订阅已中断。",
            "Bus 订阅已中断。",
        },
        {
            "心跳操作遇到查询截止",
            expired,
            active,
            "QUERY_TIMEOUT",
            "Bus 暂时不可用。",
            "设备查询超时。",
        },
        {
            "订阅退出遇到查询截止",
            expired,
            active,
            "QUERY_TIMEOUT",
            "Bus 订阅已中断。",
            "设备查询超时。",
        },
        {
            "父请求取消优先",
            expired,
            canceled,
            "",
            "Bus 暂时不可用。",
            "",
        },
        {
            "父请求取消",
            canceled,
            canceled,
            "",
            "Bus 暂时不可用。",
            "",
        },
    } {
        t.Run(item.name, func(t *testing.T) {
            code, message := queryFailure(item.query, item.parent, item.fallback)
            if code != item.code {
                t.Fatalf("错误码 %q，期望 %q", code, item.code)
            }
            if message != item.message {
                t.Fatalf("错误消息 %q，期望 %q", message, item.message)
            }
        })
    }
}
