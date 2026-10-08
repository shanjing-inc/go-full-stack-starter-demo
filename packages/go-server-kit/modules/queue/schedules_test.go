package queue

// 本文件覆盖Redis 调度登记与后台历史的关联。

import (
    "context"
    "errors"
    "strings"
    "testing"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/schedule"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
)

func TestScheduleRegistrationRedis(t *testing.T) {
    s, cfg, _ := redisService(t, &memoryInspector{})
    d := schedule.Definition{Name: "tick", Expression: "@every 1m", Timezone: "Asia/Shanghai"}
    definitions := []schedule.Definition{d}
    registered, err := New(s.redis, s.inspector, cfg, s.retention, definitions...)
    if err != nil {
        t.Fatal(err)
    }

    definitions[0].Name = "changed"
    p, err := registered.Schedules(context.Background())
    if err != nil || p.ScheduleCount != 1 || p.Schedules[0].Name != "tick" {
        t.Fatal(p, err)
    }
    if _, err := New(s.redis, s.inspector, cfg, s.retention, d, d); err == nil {
        t.Fatal("重复名称需要配置错误")
    }

    d.Expression = "invalid"
    if _, err := New(s.redis, s.inspector, cfg, s.retention, d); err == nil {
        t.Fatal("无效计划需要配置错误")
    }
    if err := s.redis.Close(); err != nil {
        t.Fatal(err)
    }

    _, err = registered.Schedules(context.Background())
    var public *httperr.Error
    if !errors.As(err, &public) || public.Code != "SERVICE_UNAVAILABLE" || strings.Contains(err.Error(), "redis:") {
        t.Fatal("计划读取异常需要统一公共错误", err)
    }
}
