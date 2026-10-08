// Package schema 仅查询 Atlas 版本登记；迁移通过部署前独立命令执行。
package schema

import (
    "context"
    "database/sql"
    "errors"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    _ "modernc.org/sqlite"
)

// ErrUnavailable 表示版本登记读取失败。
var ErrUnavailable = errors.New("数据库版本检查失败")

// ErrVersion 表示最新登记版本与应用预期版本不同。
var ErrVersion = errors.New("数据库迁移版本不匹配")

// ErrIncomplete 表示至少一条迁移登记尚未完整成功。
var ErrIncomplete = errors.New("数据库迁移记录未完成")

// Gate 持有独立版本检查连接池及应用期望的迁移版本。
type Gate struct {
    DB       *sql.DB
    Expected string
}

// Open 打开独立连接并校验版本，失败时释放连接池。
func Open(ctx context.Context, driver, dsn, expected string) (*Gate, error) {
    db, err := sql.Open(database.SQLDriver(driver), dsn)
    if err != nil {
        return nil, ErrUnavailable
    }
    db.SetMaxOpenConns(2)
    db.SetMaxIdleConns(1)
    db.SetConnMaxLifetime(time.Minute)
    g := &Gate{DB: db, Expected: expected}
    if err = g.Check(ctx); err != nil {
        db.Close()
        return nil, err
    }
    return g, nil
}

// Close 释放版本检查连接池。
func (g *Gate) Close() error { return g.DB.Close() }

// Check 核验全部 Atlas 登记的完成状态，再比较最新版本与 Expected。
func (g *Gate) Check(ctx context.Context) error {
    rows, err := g.DB.QueryContext(ctx, "SELECT version, type, applied, total, error FROM atlas_schema_revisions ORDER BY version")
    if err != nil {
        return ErrUnavailable
    }
    defer rows.Close()
    latest := ""
    for rows.Next() {
        var version string
        var kind, applied, total int
        var failure sql.NullString
        if rows.Scan(&version, &kind, &applied, &total, &failure) != nil {
            return ErrUnavailable
        }
        if (kind != 1 && kind != 2) || applied < 0 || total < 0 || applied != total || (failure.Valid && failure.String != "") {
            return ErrIncomplete
        }

        latest = version
    }

    if rows.Err() != nil {
        return ErrUnavailable
    }
    if latest != g.Expected {
        return ErrVersion
    }
    return nil
}
