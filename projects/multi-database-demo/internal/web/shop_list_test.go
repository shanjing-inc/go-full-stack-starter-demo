package server_test

// 本文件覆盖后台店铺分页协议与数据库重开后的查询。

import (
    "context"
    "encoding/json"
    "fmt"
    "path/filepath"
    "strings"
    "testing"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/model"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
)

func TestAdminShopListProtocol(t *testing.T) {
    shops := newMemory()
    for i := range 3 {
        status := "active"
        if i == 1 {
            status = "inactive"
        }
        if _, err := shops.Create(context.Background(), service.Create{
            Name:   fmt.Sprintf("列表%d", i),
            Slug:   fmt.Sprintf("list-%d", i),
            Status: &status,
        }); err != nil {
            t.Fatal(err)
        }
    }

    h := subject.New(shops, subject.Config{Introspection: true})
    for _, item := range []struct{ name, query, expected string }{
        {
            "默认排序",
            `{listShops(limit:2){id slug}}`,
            `{"data":{"listShops":[{"id":"4","slug":"list-2"},{"id":"3","slug":"list-1"}]}}`,
        },
        {
            "分页",
            `{listShops(limit:2,offset:2){id}}`,
            `{"data":{"listShops":[{"id":"2"},{"id":"1"}]}}`,
        },
        {
            "组合筛选",
            `{listShops(where:{slug:{like:"%list%"},status:{eq:"inactive"}}){id}}`,
            `{"data":{"listShops":[{"id":"3"}]}}`,
        },
        {
            "精确与模糊并用",
            `{listShops(where:{slug:{eq:"list-0",like:"list-%"}}){id}}`,
            `{"data":{"listShops":[{"id":"2"}]}}`,
        },
        {
            "排序优先级",
            `{listShops(where:{slug:{like:"list-%"}},orderBy:{status:{direction:desc,priority:1},id:{direction:asc,priority:2}}){id}}`,
            `{"data":{"listShops":[{"id":"3"},{"id":"2"},{"id":"4"}]}}`,
        },
        {
            "空列表",
            `{listShops(offset:50){id}}`,
            `{"data":{"listShops":[]}}`,
        },
        {
            "零条",
            `{listShops(limit:0){id}}`,
            `{"data":{"listShops":[]}}`,
        },
    } {
        t.Run(item.name, func(t *testing.T) {
            body, _ := json.Marshal(map[string]any{"query": item.query})
            result := perform(h, "POST", subject.AdminPath, string(body), nil)
            if result.Code != 200 || strings.TrimSpace(result.Body.String()) != item.expected {
                t.Fatalf("列表协议：%d %s", result.Code, result.Body.String())
            }
        })
    }

    for _, query := range []string{
        `{listShops(limit:-1){id}}`, `{listShops(limit:102){id}}`, `{listShops(offset:-1){id}}`,
        `{listShops(orderBy:{id:{direction:desc,priority:0}}){id}}`,
        `{listShops(where:{slug:{ne:"demo"}}){id}}`, `{listShops(where:{status:{like:"active"}}){id}}`,
    } {
        body, _ := json.Marshal(map[string]any{"query": query})
        result := perform(h, "POST", subject.AdminPath, string(body), nil)
        if !strings.Contains(result.Body.String(), "BAD_USER_INPUT") {
            t.Fatalf("无效条件未拒绝：%s", result.Body.String())
        }
    }
}

func TestShopListAfterDatabaseReopen(t *testing.T) {
    ctx := context.Background()
    path := filepath.Join(t.TempDir(), "persistent.sqlite")
    db, err := database.Open(ctx, "sqlite", path)
    if err != nil {
        t.Fatal(err)
    }

    pool, _ := db.DB()
    t.Cleanup(func() { pool.Close() })
    if err := db.AutoMigrate(model.Models()...); err != nil {
        t.Fatal(err)
    }

    h := subject.New(service.NewDatabase(db), subject.Config{})
    for _, slug := range []string{"persistent-a", "persistent-b"} {
        body, _ := json.Marshal(map[string]any{
            "query":     `mutation($set:CreateShopSetInput!){createShop(set:$set){id}}`,
            "variables": map[string]any{"set": map[string]string{"name": "持久化店铺", "slug": slug}},
        })
        result := perform(h, "POST", subject.AdminPath, string(body), nil)
        if result.Code != 200 || strings.Contains(result.Body.String(), "errors") {
            t.Fatalf("创建失败：%s", result.Body.String())
        }
    }

    if err := pool.Close(); err != nil {
        t.Fatal(err)
    }

    reopened, err := database.Open(ctx, "sqlite", path)
    if err != nil {
        t.Fatal(err)
    }

    reopenedPool, _ := reopened.DB()
    t.Cleanup(func() { reopenedPool.Close() })
    h = subject.New(service.NewDatabase(reopened), subject.Config{})
    result := perform(h, "POST", subject.AdminPath, `{"query":"{listShops(limit:1,offset:1,orderBy:{id:{direction:desc,priority:1}}){id slug}}"}`, nil)
    expected := `{"data":{"listShops":[{"id":"1","slug":"persistent-a"}]}}`
    if result.Code != 200 || strings.TrimSpace(result.Body.String()) != expected {
        t.Fatalf("重新打开数据库后的列表失效：%s", result.Body.String())
    }
}
