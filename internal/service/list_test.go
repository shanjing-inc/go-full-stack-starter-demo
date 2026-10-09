package service_test

// 本文件覆盖店铺筛选、分页、排序与内存和数据库实现的一致性。

import (
    "context"
    "errors"
    "fmt"
    "path/filepath"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/model"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
)

func TestShopLists(t *testing.T) {
    for _, backend := range []string{"memory", "sqlite"} {
        t.Run(backend, func(t *testing.T) {
            ctx := context.Background()
            var shops subject.Shops = subject.NewMemory(func() time.Time { return time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC) })
            if backend == "sqlite" {
                db, err := database.Open(ctx, "sqlite", filepath.Join(t.TempDir(), "list.sqlite"))
                if err != nil {
                    t.Fatal(err)
                }

                pool, _ := db.DB()
                t.Cleanup(func() { pool.Close() })
                if err := db.AutoMigrate(model.Models()...); err != nil {
                    t.Fatal(err)
                }

                shops = subject.NewDatabase(db)
            }

            ids := []int{}
            for i := range 25 {
                status := "active"
                if i%2 == 1 {
                    status = "inactive"
                }

                row, err := shops.Create(ctx, subject.Create{
                    Name:   fmt.Sprintf("店铺%02d", i),
                    Slug:   fmt.Sprintf("list-%02d", i),
                    Status: &status,
                })
                if err != nil {
                    t.Fatal(err)
                }

                ids = append(ids, row.ID)
            }

            like := "list-%"
            q := subject.ListQuery{
                Limit:    10,
                SlugLike: &like,
                Order:    []subject.ShopOrder{{Field: "id", Desc: true}},
            }
            rows, err := shops.List(ctx, q)
            if err != nil || len(rows) != 10 || rows[0].ID != ids[24] || rows[9].ID != ids[15] {
                t.Fatalf("首页排序或条数错误：%v %v", rows, err)
            }

            q.Offset = 10
            rows, err = shops.List(ctx, q)
            if err != nil || len(rows) != 10 || rows[0].ID != ids[14] {
                t.Fatalf("第二页错误：%v %v", rows, err)
            }

            q.Offset = 20
            rows, err = shops.List(ctx, q)
            if err != nil || len(rows) != 5 {
                t.Fatalf("末页错误：%v %v", rows, err)
            }

            q.Offset = 0
            q.Limit = 101
            active := "active"
            q.Where.Status = &active
            rows, err = shops.List(ctx, q)
            if err != nil || len(rows) != 13 {
                t.Fatalf("状态筛选错误：%v %v", rows, err)
            }

            q.Where.ID = &ids[0]
            rows, err = shops.List(ctx, q)
            if err != nil || len(rows) != 1 || rows[0].Slug != "list-00" {
                t.Fatalf("组合筛选错误：%v %v", rows, err)
            }

            q.Where = subject.Lookup{}
            exact := "list-12"
            q.Where.Slug = &exact
            rows, err = shops.List(ctx, q)
            if err != nil || len(rows) != 1 {
                t.Fatalf("精确标识错误：%v %v", rows, err)
            }

            q.Where = subject.Lookup{}
            wildcard := "list-0_"
            q.SlugLike = &wildcard
            q.Order = []subject.ShopOrder{{Field: "name"}}
            rows, err = shops.List(ctx, q)
            if err != nil || len(rows) != 10 || rows[0].Name != "店铺00" {
                t.Fatalf("LIKE 或升序错误：%v %v", rows, err)
            }

            q.Offset = 999
            rows, err = shops.List(ctx, q)
            if err != nil || rows == nil || len(rows) != 0 {
                t.Fatalf("空页错误：%v %v", rows, err)
            }

            rows, err = shops.List(ctx, subject.ListQuery{Limit: 0})
            if err != nil || len(rows) != 0 {
                t.Fatalf("零 limit 错误：%v %v", rows, err)
            }

            for _, invalid := range []subject.ListQuery{
                {Limit: -1},
                {Limit: 102},
                {Limit: 10, Offset: -1},
                {Limit: 10, Order: []subject.ShopOrder{{Field: "secret"}}},
            } {
                _, err := shops.List(ctx, invalid)
                var business *subject.Error
                if !errors.As(err, &business) || business.Code != "BAD_USER_INPUT" {
                    t.Fatalf("无效条件应有业务错误：%v", err)
                }
            }

            cancelled, cancel := context.WithCancel(ctx)
            cancel()
            if _, err := shops.List(cancelled, subject.ListQuery{Limit: 10}); !errors.Is(err, context.Canceled) {
                t.Fatalf("取消失效：%v", err)
            }
            // 无排序输入时同一创建时间使用 ID 降序，连续读取顺序保持一致。
            first, err := shops.List(ctx, subject.ListQuery{Limit: 10, SlugLike: &like})
            if err != nil || first[0].ID != ids[24] {
                t.Fatalf("默认排序错误：%v", err)
            }
        })
    }
}
