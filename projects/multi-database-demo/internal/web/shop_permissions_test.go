package server_test

// 本文件覆盖店铺只读权限对应的创建操作拒绝行为。

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
    "context"
    "net/http"
    "path/filepath"
    "strconv"
    "testing"
    "time"
)

func TestShopReadPermissionCannotCreate(t *testing.T) {
    db, err := database.Open(context.Background(), "sqlite", filepath.Join(t.TempDir(), "review.sqlite"))
    if err != nil {
        t.Fatal(err)
    }

    sql, _ := db.DB()
    defer sql.Close()
    if err = db.AutoMigrate(auth.Models()...); err != nil {
        t.Fatal(err)
    }

    role := "shop_reader"
    user := auth.User{
        ID:    1,
        Name:  "只读店铺用户",
        Email: "reader@example.test",
        Role:  &role,
    }
    if err = db.Create(&user).Error; err != nil {
        t.Fatal(err)
    }
    if err = db.Create(&auth.Session{
        UserID:    1,
        Token:     "review-read-token",
        ExpiresAt: time.Now().Add(time.Hour).UTC(),
    }).Error; err != nil {
        t.Fatal(err)
    }

    authentication, err := auth.New(db, auth.Config{
        Secret:      "review-secret-at-least-32-bytes-long",
        AdminPaths:  []string{subject.AdminPath},
        Permissions: shopReaderPermissions(),
    })
    if err != nil {
        t.Fatal(err)
    }
    if authentication.Allows(&user, "shop", "create") {
        t.Fatal("测试角色含有写权限")
    }

    api := subject.New(newMemory(), subject.Config{Authentication: authentication})
    api.Use(authentication.Guard)
    for _, item := range []struct{ query, code string }{
        {`{listShops{id}}`, ""},
        {`mutation{createShop(set:{name:"越权创建",slug:"review-read-only"}){id name}}`, "FORBIDDEN"},
    } {
        payload := `{"query":` + strconv.Quote(item.query) + `}`
        got := perform(api, http.MethodPost, subject.AdminPath, payload, map[string]string{"Authorization": "Bearer review-read-token"})
        body := decoded(t, got.Body.Bytes()).(map[string]any)
        if got.Code != 200 {
            t.Fatal(got.Code, body)
        }
        if item.code == "" {
            if body["errors"] != nil {
                t.Fatal(body)
            }
        } else {
            err := body["errors"].([]any)[0].(map[string]any)
            if err["extensions"].(map[string]any)["code"] != item.code {
                t.Fatal(body)
            }
        }
    }

    for _, role := range []string{"admin", "owner"} {
        if err = db.Model(&auth.User{}).Where("id = 1").Update("role", role).Error; err != nil {
            t.Fatal(err)
        }

        query := `mutation{createShop(set:{name:"管理员创建",slug:"allowed-` + role + `"}){id name}}`
        got := perform(api, http.MethodPost, subject.AdminPath, `{"query":`+strconv.Quote(query)+`}`, map[string]string{"Authorization": "Bearer review-read-token"})
        body := decoded(t, got.Body.Bytes()).(map[string]any)
        if got.Code != 200 || body["errors"] != nil {
            t.Fatal(got.Code, body)
        }
    }
}

func shopReaderPermissions() auth.RolePermissions {
    permissions := auth.DefaultRolePermissions()
    permissions["shop_reader"] = []auth.Permission{{Resource: "dashboard", Action: "access:admin"}, {Resource: "shop", Action: "list"}}
    return permissions
}
