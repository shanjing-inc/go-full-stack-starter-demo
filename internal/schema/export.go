// Package schema 导出 MySQL、PostgreSQL 与 SQLite 的应用组合模型。
package schema

import (
    "fmt"
    "regexp"
    "strings"
    "sync"

    "ariga.io/atlas-provider-gorm/gormschema"
    "gorm.io/gorm"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/model"
)

var exportMu sync.Mutex

var exported bool

var textColumn = regexp.MustCompile(`(varchar\([0-9]+\)|text)([, )])`)

// UnicodeCollation 保持示例字符串的大小写与重音不敏感比较。
// PostgreSQL 18 支持此排序规则下的 LIKE；角色权限使用 C 排序规则逐项匹配。
const UnicodeCollation = `CREATE COLLATION "starter_unicode_ci" (provider = icu, locale = 'und-u-ks-level1', deterministic = false);`

// Export 使用记录驱动导出，每次命令保持独立进程且零数据库连接。
func Export(dialect string) (string, error) {
    if dialect != "mysql" && dialect != "postgres" && dialect != "sqlite" {
        return "", fmt.Errorf("未知方言：%s", dialect)
    }
    exportMu.Lock()
    defer exportMu.Unlock()
    if exported {
        return "", fmt.Errorf("当前进程已使用 Schema Provider，请为下一次导出启动独立进程")
    }

    exported = true
    sql, err := gormschema.New(dialect, gormschema.WithConfig(&gorm.Config{
        DisableForeignKeyConstraintWhenMigrating: true,
    })).Load(model.Models()...)
    if err != nil {
        return "", fmt.Errorf("导出 GORM Schema：%w", err)
    }

    quote := "`"
    if dialect == "postgres" {
        quote = `"`
    }

    lines := strings.Split(strings.TrimSpace(sql), "\n")
    tables := 0
    for i, line := range lines {
        if !strings.HasPrefix(line, "CREATE TABLE ") {
            continue
        }
        if !strings.HasSuffix(line, ");") {
            return "", fmt.Errorf("GORM CREATE TABLE 输出格式发生变化，需审核方言补充逻辑")
        }
        tables++
        if dialect == "postgres" {
            line = textColumn.ReplaceAllString(line, `$1 COLLATE "starter_unicode_ci"$2`)
        }

        for _, table := range []string{"session", "account"} {
            if strings.HasPrefix(line, "CREATE TABLE "+quote+table+quote) {
                q := func(value string) string { return quote + value + quote }
                suffix := ",CONSTRAINT " + q(table+"_user_id_user_id_fk") + " FOREIGN KEY (" + q("user_id") + ") REFERENCES " + q("user") + " (" + q("id") + ") ON DELETE CASCADE);"
                line = strings.TrimSuffix(line, ");") + suffix
            }
        }

        lines[i] = line
    }

    if tables != len(model.Models()) {
        return "", fmt.Errorf("应用组合模型与导出表数不符，实际导出 %d 张", tables)
    }

    sql = strings.Join(lines, "\n") + "\n"
    if dialect == "postgres" {
        sql = UnicodeCollation + "\n" + sql
    }
    if dialect == "mysql" {
        return mysqlAttributes(sql)
    }
    return sql, nil
}

// mysqlAttributes 记录模型标签之外的表属性。
// 示例采用 utf8mb4_unicode_ci；既有业务导入时按真实库快照审核。
func mysqlAttributes(sql string) (string, error) {
    sql = strings.ReplaceAll(sql, "datetime NULL", "datetime")
    lines := strings.Split(strings.TrimSpace(sql), "\n")
    count := 0
    for i, line := range lines {
        if strings.HasPrefix(strings.TrimSpace(line), "CREATE TABLE ") {
            if !strings.HasSuffix(line, ";") {
                return "", fmt.Errorf("GORM CREATE TABLE 输出格式发生变化，需审核方言补充逻辑")
            }
            if !strings.HasPrefix(line, "CREATE TABLE `shop`") {
                line = strings.ReplaceAll(line, "`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP", "`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
            }

            lines[i] = strings.TrimSuffix(line, ";") + " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;"
            count++
        }
    }

    if count != len(model.Models()) {
        return "", fmt.Errorf("应用组合模型与导出表数不符，实际导出 %d 张", count)
    }
    return strings.Join(lines, "\n") + "\n", nil
}
