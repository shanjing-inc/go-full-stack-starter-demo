// Package databasegate 只读核验数据库迁移状态与应用交付版本。
package databasegate

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "regexp"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    revision "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database/revision"
)

// DatabaseVersion 随应用交付，与三方言最新迁移一致，不接受环境变量覆盖。
const DatabaseVersion = "202610210001"

var migrationVersion = regexp.MustCompile(`^[0-9]{6,14}$`)

const migrationHint = "请在应用目录使用与本次启动相同的后端配置执行 pnpm migrate（自定义配置须传 --env-file），成功后重新启动，无需修改 DB_VERSION"

// Gate 复用公共迁移完整性检查，补充应用版本策略和可操作的启动诊断。
type Gate struct {
    gate *revision.Gate
}

// Open 只读检查实际迁移状态；连接池由应用持有，以便在版本不符时读取诊断信息。
func Open(ctx context.Context, driver, dsn string) (*Gate, error) {
    db, err := sql.Open(database.SQLDriver(driver), dsn)
    if err != nil {
        return nil, revision.ErrUnavailable
    }
    db.SetMaxOpenConns(2)
    db.SetMaxIdleConns(1)
    db.SetConnMaxLifetime(time.Minute)
    g := &Gate{gate: &revision.Gate{DB: db, Expected: DatabaseVersion}}
    if err := g.Check(ctx); err != nil {
        db.Close()
        return nil, err
    }
    return g, nil
}

// Check 在启动和 readiness 使用同一版本要求，不执行迁移或写入登记表。
func (g *Gate) Check(ctx context.Context) error {
    err := g.gate.Check(ctx)
    if errors.Is(err, revision.ErrIncomplete) {
        return fmt.Errorf("%w；%s", err, migrationHint)
    }
    if !errors.Is(err, revision.ErrVersion) {
        return err
    }
    var latest string
    readErr := g.gate.DB.QueryRowContext(ctx, "SELECT version FROM atlas_schema_revisions ORDER BY version DESC LIMIT 1").Scan(&latest)
    if errors.Is(readErr, sql.ErrNoRows) {
        return fmt.Errorf("%w：尚无迁移记录，应用要求 %s；%s", err, DatabaseVersion, migrationHint)
    }
    if readErr != nil {
        return revision.ErrUnavailable
    }
    if !migrationVersion.MatchString(latest) {
        return fmt.Errorf("%w：应用要求 %s，请核对 DB_DSN、迁移记录与应用版本", err, DatabaseVersion)
    }
    if latest > DatabaseVersion {
        return fmt.Errorf("%w：数据库实际版本 %s 高于应用要求 %s；请使用匹配的应用版本，并核对 DB_DSN", err, latest, DatabaseVersion)
    }
    return fmt.Errorf("%w：数据库实际版本 %s 低于应用要求 %s；%s", err, latest, DatabaseVersion, migrationHint)
}

// Close 释放版本检查连接池。
func (g *Gate) Close() error { return g.gate.Close() }
