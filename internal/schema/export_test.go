package schema_test

// 本文件覆盖认证模型导出与兼容 Schema 的一致性。

import (
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/schema"
    "strings"
    "testing"
)

func TestAuthSchemaCompatibility(t *testing.T) {
    sql, err := subject.Export("mysql")
    if err != nil {
        t.Fatal(err)
    }
    if count := strings.Count(sql, "CREATE TABLE "); count != 6 {
        t.Fatal(count)
    }

    for _, expected := range []string{
        "CREATE TABLE `user` (`id` int AUTO_INCREMENT",
        "`email_verified` boolean NOT NULL DEFAULT false",
        "`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
        "UNIQUE INDEX `account_provider_account_unique` (`provider_id`,`account_id`)",
        "CONSTRAINT `session_user_id_user_id_fk`",
        "CONSTRAINT `account_user_id_user_id_fk`",
        "ON DELETE CASCADE",
        "CREATE TABLE `auth_bootstrap`",
        "CREATE TABLE `shop` (`id` bigint",
    } {
        if !strings.Contains(sql, expected) {
            t.Fatal("Schema 漂移：", expected)
        }
    }

    if _, err = subject.Export("sqlite"); err == nil {
        t.Fatal("Provider 进程生命周期保护缺失")
    }
}
