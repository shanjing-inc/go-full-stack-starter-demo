package service_test

// 本文件覆盖各方言店铺读写，以及 PostgreSQL 绝对时间与 Unicode 名称限制。

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/model"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
    "context"
    "errors"
    "os"
    "path/filepath"
    "testing"
    "time"
)

func testDatabase(t *testing.T, driver, dsn string) {
    t.Helper()
    ctx := context.Background()
    db, err := database.Open(ctx, driver, dsn)
    if err != nil {
        t.Fatal(err)
    }

    pool, _ := db.DB()
    defer pool.Close()
    // 测试在独立库内通过 AutoMigrate 快速验证 ORM；应用启动使用 Atlas 门禁。
    if err = db.AutoMigrate(model.Models()...); err != nil {
        t.Fatal(err)
    }

    s := subject.NewDatabase(db)
    row, err := s.Create(ctx, subject.Create{Name: "示例店铺", Slug: "unit-demo"})
    if err != nil {
        t.Fatal(err)
    }
    if row.ID <= 0 || row.CreatedAt.IsZero() {
        t.Fatal("ID 与时间字段缺失")
    }

    got, err := s.Get(ctx, subject.Lookup{ID: &row.ID})
    if err != nil || got == nil || got.Name != row.Name {
        t.Fatalf("查询失败: %v", err)
    }

    _, err = s.Create(ctx, subject.Create{Name: "重复", Slug: "unit-demo"})
    var business *subject.Error
    if !errors.As(err, &business) || business.Code != "BAD_USER_INPUT" {
        t.Fatalf("唯一约束映射失败: %v", err)
    }
    if _, err = s.Get(ctx, subject.Lookup{}); err == nil {
        t.Fatal("空查询应报错")
    }

    cancelled, cancel := context.WithCancel(ctx)
    cancel()
    if _, err = s.Get(cancelled, subject.Lookup{ID: &row.ID}); err == nil {
        t.Fatal("取消需要传递")
    }
}

func TestSQLiteDatabase(t *testing.T) {
    testDatabase(t, "sqlite", filepath.Join(t.TempDir(), "app.sqlite"))
}

func TestMySQLDatabase(t *testing.T) {
    dsn := os.Getenv("MYSQL_TEST_DSN")
    if dsn == "" {
        t.Skip("需要隔离 MySQL 测试库")
    }
    testDatabase(t, "mysql", dsn)
}

func TestPostgreSQLDatabase(t *testing.T) {
    dsn := os.Getenv("POSTGRES_TEST_DSN")
    if dsn == "" {
        t.Skip("需要隔离 PostgreSQL 测试库")
    }
    testDatabase(t, "postgres", dsn)
}

func TestPostgreSQLAbsoluteTimeAndUnicodeConstraints(t *testing.T) {
    dsn := os.Getenv("POSTGRES_TEST_DSN")
    if dsn == "" {
        t.Skip("需要隔离 POSTGRES_TEST_DSN")
    }

    ctx := context.Background()
    db, err := database.Open(ctx, "postgres", dsn)
    if err != nil {
        t.Fatal(err)
    }

    pool, _ := db.DB()
    defer pool.Close()
    instant := time.Date(2026, 10, 6, 12, 30, 0, 0, time.FixedZone("CST", 8*3600))
    row := model.Shop{
        Name:      "时区回归",
        Slug:      "unicode-résumé",
        Status:    "active",
        CreatedAt: instant,
        UpdatedAt: instant,
    }
    if err := db.Create(&row).Error; err != nil {
        t.Fatal(err)
    }

    var loaded model.Shop
    if err := db.First(&loaded, row.ID).Error; err != nil || !loaded.CreatedAt.Equal(instant.UTC()) {
        t.Fatalf("跨时区读写应保持绝对时间：%v %v", loaded.CreatedAt, err)
    }

    second := model.Shop{
        Name:      "等价冲突",
        Slug:      "UNICODE-RESUME",
        Status:    "active",
        CreatedAt: instant,
        UpdatedAt: instant,
    }
    if !database.IsDuplicate(db.Create(&second).Error) {
        t.Fatal("大小写与重音等价唯一约束缺失")
    }
}
