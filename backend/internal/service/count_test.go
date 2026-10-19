package service_test

import (
    "context"
    "errors"
    "fmt"
    "path/filepath"
    "testing"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/model"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
)

func TestShopCount(t *testing.T) {
    for _, backend := range []string{"memory", "sqlite"} {
        t.Run(backend, func(t *testing.T) {
            ctx := context.Background()
            var shops subject.Shops = subject.NewMemory(nil)
            initial := int64(1)
            if backend == "sqlite" {
                db, err := database.Open(ctx, "sqlite", filepath.Join(t.TempDir(), "count.sqlite"))
                if err != nil {
                    t.Fatal(err)
                }
                pool, _ := db.DB()
                t.Cleanup(func() { _ = pool.Close() })
                if err := db.AutoMigrate(model.Models()...); err != nil {
                    t.Fatal(err)
                }
                shops = subject.NewDatabase(db)
                initial = 0
            }
            if count, err := shops.Count(ctx); err != nil || count != initial {
                t.Fatal(count, err)
            }
            for i := range 25 {
                if _, err := shops.Create(ctx, subject.Create{Name: "计数店铺", Slug: fmt.Sprintf("count-%d", i)}); err != nil {
                    t.Fatal(err)
                }
            }
            if count, err := shops.Count(ctx); err != nil || count != initial+25 {
                t.Fatal(count, err)
            }
            canceled, cancel := context.WithCancel(ctx)
            cancel()
            if _, err := shops.Count(canceled); !errors.Is(err, context.Canceled) {
                t.Fatalf("取消语义失效：%v", err)
            }
        })
    }
}
