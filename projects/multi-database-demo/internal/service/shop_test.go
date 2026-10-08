package service_test

// 本文件覆盖内存店铺的创建、查询与副本隔离。

import (
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
    "context"
    "errors"
    "testing"
    "time"
)

func TestMemory(t *testing.T) {
    m := subject.NewMemory(func() time.Time { return time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC) })
    ctx := context.Background()
    row, err := m.Create(ctx, subject.Create{Name: "样例", Slug: "created"})
    if err != nil || row.ID != 2 {
        t.Fatalf("创建失效：%v", err)
    }

    _, err = m.Create(ctx, subject.Create{Name: "重复", Slug: "created"})
    var business *subject.Error
    if !errors.As(err, &business) || business.Code != "BAD_USER_INPUT" {
        t.Fatal("唯一约束边界失效")
    }

    got, err := m.Get(ctx, subject.Lookup{ID: &row.ID})
    if err != nil || got == nil || got.Slug != "created" {
        t.Fatal("查询失效")
    }

    got.Name = "外部副本"
    again, _ := m.Get(ctx, subject.Lookup{ID: &row.ID})
    if again.Name != "样例" {
        t.Fatal("外部修改影响内部记录")
    }

    _, err = m.Get(ctx, subject.Lookup{})
    if !errors.As(err, &business) {
        t.Fatal("空条件缺少业务错误")
    }

    canceled, cancel := context.WithCancel(ctx)
    cancel()
    if _, err = m.Create(canceled, subject.Create{Name: "取消", Slug: "canceled"}); !errors.Is(err, context.Canceled) {
        t.Fatal("取消失效")
    }
    if _, err = m.Get(canceled, subject.Lookup{ID: &row.ID}); !errors.Is(err, context.Canceled) {
        t.Fatal("取消查询失效")
    }
}
