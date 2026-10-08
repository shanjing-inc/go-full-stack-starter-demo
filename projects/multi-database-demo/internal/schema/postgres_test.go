package schema_test

// 本文件覆盖PostgreSQL Schema 导出结构。

import (
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/schema"
    "os"
    "os/exec"
    "strings"
    "testing"
)

func TestPostgreSQLSchema(t *testing.T) {
    if os.Getenv("SCHEMA_POSTGRES_TEST") != "1" {
        cmd := exec.Command(os.Args[0], "-test.run=^TestPostgreSQLSchema$")
        cmd.Env = append(os.Environ(), "SCHEMA_POSTGRES_TEST=1")
        if out, err := cmd.CombinedOutput(); err != nil {
            t.Fatalf("隔离 PostgreSQL Schema 测试：%v\n%s", err, out)
        }
        return
    }

    sql, err := subject.Export("postgres")
    if err != nil {
        t.Fatal(err)
    }
    if count := strings.Count(sql, "CREATE TABLE "); count != 6 {
        t.Fatal(count)
    }

    for _, expected := range []string{
        subject.UnicodeCollation,
        `CREATE TABLE "user" ("id" serial`,
        `"email" varchar(255) COLLATE "starter_unicode_ci"`,
        `timestamptz`,
        `"account_provider_account_unique"`,
        `"session_user_id_user_id_fk"`,
        `"account_user_id_user_id_fk"`,
        `ON DELETE CASCADE`,
        `CREATE TABLE "auth_bootstrap"`,
        `CREATE TABLE "shop" ("id" bigserial`,
    } {
        if !strings.Contains(sql, expected) {
            t.Fatal("Schema 漂移：", expected)
        }
    }

    for _, legacy := range []string{"datetime", "AUTO_INCREMENT", "ENGINE=", "`"} {
        if strings.Contains(sql, legacy) {
            t.Fatal("PostgreSQL Schema 存在其他方言语法：", legacy)
        }
    }

    if _, err = subject.Export("sqlite"); err == nil {
        t.Fatal("Provider 进程生命周期保护缺失")
    }
}
