// Package database 提供 MySQL、PostgreSQL 与纯 Go SQLite 的连接工厂；版本化迁移由应用单独执行。
package database

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "time"

    "gorm.io/driver/mysql"
    "gorm.io/driver/postgres"
    "gorm.io/driver/sqlite"
    "gorm.io/gorm"
    "gorm.io/gorm/logger"
    _ "modernc.org/sqlite"
)

// initializationPool 将方言的启动探测绑定到调用方生命周期。
// 完成初始化后恢复原始连接池，后续查询使用各自的 context。
type initializationPool struct {
    *sql.DB
    ctx context.Context
}

// PrepareContext 在启动上下文内创建语句，约束方言初始化的 I/O 期限。
func (p initializationPool) PrepareContext(_ context.Context, query string) (*sql.Stmt, error) {
    return p.DB.PrepareContext(p.ctx, query)
}

// ExecContext 在启动上下文内执行初始化语句。
func (p initializationPool) ExecContext(_ context.Context, query string, args ...any) (sql.Result, error) {
    return p.DB.ExecContext(p.ctx, query, args...)
}

// QueryContext 在启动上下文内读取初始化查询。
func (p initializationPool) QueryContext(_ context.Context, query string, args ...any) (*sql.Rows, error) {
    return p.DB.QueryContext(p.ctx, query, args...)
}

// QueryRowContext 在启动上下文内读取单行初始化查询。
func (p initializationPool) QueryRowContext(_ context.Context, query string, args ...any) *sql.Row {
    return p.DB.QueryRowContext(p.ctx, query, args...)
}

// Open 打开指定方言并在调用方上下文内完成启动探测，成功后由调用方关闭连接池。
func Open(ctx context.Context, driver, dsn string) (*gorm.DB, error) {
    if driver != "mysql" && driver != "postgres" && driver != "sqlite" {
        return nil, errors.New("数据库方言无效")
    }
    if err := ctx.Err(); err != nil {
        return nil, fmt.Errorf("数据库启动检查失败: %w", err)
    }

    sqlDB, err := sql.Open(SQLDriver(driver), dsn)
    if err != nil {
        return nil, errors.New("数据库连接失败")
    }
    return initialize(ctx, driver, dsn, sqlDB)
}

// initialize 配置连接池与方言并执行启动探测；失败释放连接，成功解除启动上下文绑定。
func initialize(ctx context.Context, driver, dsn string, sqlDB *sql.DB) (db *gorm.DB, err error) {
    defer func() {
        if err != nil {
            sqlDB.Close()
            if cause := ctx.Err(); cause != nil {
                err = fmt.Errorf("%s: %w", err, cause)
            }
        }
    }()
    sqlDB.SetMaxOpenConns(10)
    sqlDB.SetMaxIdleConns(2)
    sqlDB.SetConnMaxLifetime(5 * time.Minute)
    if driver == "sqlite" {
        sqlDB.SetMaxOpenConns(1)
    }

    pool := initializationPool{DB: sqlDB, ctx: ctx}
    var dialect gorm.Dialector
    switch driver {
    case "mysql":
        dialect = mysql.New(mysql.Config{DSN: dsn, Conn: pool})
    case "postgres":
        dialect = postgres.New(postgres.Config{DSN: dsn, Conn: pool})
    case "sqlite":
        dialect = sqlite.New(sqlite.Config{DriverName: "sqlite", DSN: dsn, Conn: pool})
    }

    db, err = gorm.Open(dialect, &gorm.Config{
        TranslateError:                           true,
        DisableForeignKeyConstraintWhenMigrating: true,
        DisableAutomaticPing:                     true,
        Logger:                                   logger.Default.LogMode(logger.Silent),
    })
    if err != nil {
        return nil, errors.New("数据库连接失败")
    }
    if sqlDB.PingContext(ctx) != nil {
        return nil, errors.New("数据库启动检查失败")
    }
    // 清除启动 context 的全部引用，保留方言探测得到的版本与能力配置。
    switch d := dialect.(type) {
    case *mysql.Dialector:
        d.Conn = sqlDB
    case *postgres.Dialector:
        d.Conn = sqlDB
    case *sqlite.Dialector:
        d.Conn = sqlDB
    }

    db.ConnPool = sqlDB
    db.Statement.ConnPool = sqlDB
    return db, nil
}

// SQLDriver 对齐 GORM 方言名与 database/sql 注册名。
func SQLDriver(dialect string) string {
    if dialect == "postgres" {
        return "pgx"
    }
    return dialect
}
