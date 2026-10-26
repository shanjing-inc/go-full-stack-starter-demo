package databasegate_test

import (
    "context"
    "database/sql"
    "errors"
    "os"
    "path/filepath"
    "sort"
    "strings"
    "testing"

    revision "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database/revision"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/databasegate"
)

func TestDatabaseVersionMatchesMigrations(t *testing.T) {
    for _, dialect := range []string{"mysql", "postgres", "sqlite"} {
        paths, err := filepath.Glob("../../migrations/" + dialect + "/*.sql")
        if err != nil || len(paths) == 0 {
            t.Fatalf("%s 迁移缺失：%v", dialect, err)
        }
        sort.Strings(paths)
        latest := strings.SplitN(filepath.Base(paths[len(paths)-1]), "_", 2)[0]
        if latest != subject.DatabaseVersion {
            t.Fatalf("%s 最新迁移 %s 与应用要求 %s 不一致", dialect, latest, subject.DatabaseVersion)
        }
    }
}

func TestDatabaseGate(t *testing.T) {
    cases := []struct {
        name, rows string
        want       error
        hints      []string
    }{
        {"已迁移且保留旧环境变量", "('" + subject.DatabaseVersion + "',2,2,2,NULL)", nil, nil},
        {"版本落后", "('202610040001',2,2,2,NULL)", revision.ErrVersion, []string{"实际版本 202610040001", "低于应用要求 " + subject.DatabaseVersion, "pnpm migrate", "--env-file"}},
        {"版本超前", "('99999999999999',2,2,2,NULL)", revision.ErrVersion, []string{"实际版本 99999999999999", "高于应用要求 " + subject.DatabaseVersion, "匹配的应用版本"}},
        {"空记录", "", revision.ErrVersion, []string{"尚无迁移记录", "pnpm migrate"}},
        {"未完成", "('" + subject.DatabaseVersion + "',2,1,2,NULL)", revision.ErrIncomplete, []string{"迁移记录未完成", "pnpm migrate"}},
        {"历史迁移失败", "('202610040001',2,2,2,'private-secret'),('" + subject.DatabaseVersion + "',2,2,2,NULL)", revision.ErrIncomplete, []string{"迁移记录未完成"}},
        {"异常版本脱敏", "('private-secret',2,2,2,NULL)", revision.ErrVersion, []string{"请核对 DB_DSN"}},
        {"缺表", "missing", revision.ErrUnavailable, []string{"atlas_schema_revisions", "数据库迁移", "DB_DSN"}},
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            t.Setenv("DB_VERSION", "202610040001")
            file := filepath.Join(t.TempDir(), "db.sqlite")
            db := migrationFixture(t, file)
            if c.rows == "missing" {
                execMigrationFixture(t, db, "DROP TABLE atlas_schema_revisions")
            } else if c.rows != "" {
                execMigrationFixture(t, db, "INSERT INTO atlas_schema_revisions VALUES "+c.rows)
            }
            db.Close()
            before, err := os.ReadFile(file)
            if err != nil {
                t.Fatal(err)
            }
            gate, err := subject.Open(context.Background(), "sqlite", "file:"+file+"?mode=ro&_pragma=query_only(1)")
            if !errors.Is(err, c.want) {
                t.Fatalf("实际 %v，预期 %v", err, c.want)
            }
            if gate != nil {
                if err := gate.Check(context.Background()); err != nil {
                    t.Fatal(err)
                }
                gate.Close()
            }
            if err != nil {
                for _, hint := range c.hints {
                    if !strings.Contains(err.Error(), hint) {
                        t.Errorf("错误缺少 %q：%v", hint, err)
                    }
                }
                if strings.Contains(err.Error(), "private-secret") {
                    t.Fatal("泄露迁移记录内容", err)
                }
                if c.name == "版本超前" && strings.Contains(err.Error(), "pnpm migrate") {
                    t.Fatal("版本超前不能提示继续迁移", err)
                }
            }
            after, err := os.ReadFile(file)
            if err != nil {
                t.Fatal(err)
            }
            if string(before) != string(after) {
                t.Fatal("版本检查修改了数据库")
            }
        })
    }
}

func TestDatabaseGateReadiness(t *testing.T) {
    file := filepath.Join(t.TempDir(), "db.sqlite")
    db := migrationFixture(t, file)
    execMigrationFixture(t, db, "INSERT INTO atlas_schema_revisions VALUES ('"+subject.DatabaseVersion+"',2,2,2,NULL)")
    gate, err := subject.Open(context.Background(), "sqlite", file)
    if err != nil {
        t.Fatal(err)
    }
    defer gate.Close()
    execMigrationFixture(t, db, "UPDATE atlas_schema_revisions SET applied=0")
    if err := gate.Check(context.Background()); !errors.Is(err, revision.ErrIncomplete) {
        t.Fatal(err)
    }
    execMigrationFixture(t, db, "UPDATE atlas_schema_revisions SET applied=total, version='99999999999999'")
    if err := gate.Check(context.Background()); !errors.Is(err, revision.ErrVersion) {
        t.Fatal(err)
    }
    execMigrationFixture(t, db, "UPDATE atlas_schema_revisions SET version='"+subject.DatabaseVersion+"'")
    if err := gate.Check(context.Background()); err != nil {
        t.Fatal(err)
    }
    ctx, cancel := context.WithCancel(context.Background())
    cancel()
    if err := gate.Check(ctx); !errors.Is(err, revision.ErrUnavailable) {
        t.Fatal(err)
    }
}

func migrationFixture(t *testing.T, file string) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite", file)
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { db.Close() })
    execMigrationFixture(t, db, "CREATE TABLE atlas_schema_revisions(version TEXT PRIMARY KEY,type INTEGER,applied INTEGER,total INTEGER,error TEXT)")
    return db
}

func execMigrationFixture(t *testing.T, db *sql.DB, query string) {
    t.Helper()
    if _, err := db.Exec(query); err != nil {
        t.Fatal(err)
    }
}
