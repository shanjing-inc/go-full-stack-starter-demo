package schema_test

// 本文件覆盖版本登记的可用性、最新版本匹配及迁移完成状态。

import (
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database/revision"
    "context"
    "database/sql"
    "errors"
    "os"
    "path/filepath"
    "testing"
)

func TestGate(t *testing.T) {
    cases := []struct {
        name, rows, expected string
        want                 error
    }{
        {
            "完整版本",
            `('000001',1,0,0,NULL),('000002',2,2,2,NULL)`,
            "000002",
            nil,
        },
        {
            "版本落后",
            `('000001',1,0,0,NULL)`,
            "000002",
            subject.ErrVersion,
        },
        {
            "版本超前",
            `('000003',2,1,1,NULL)`,
            "000002",
            subject.ErrVersion,
        },
        {"空记录", "", "000002", subject.ErrVersion},
        {
            "未完成",
            `('000002',2,1,2,NULL)`,
            "000002",
            subject.ErrIncomplete,
        },
        {
            "失败记录",
            `('000002',2,2,2,'private-secret')`,
            "000002",
            subject.ErrIncomplete,
        },
        {
            "手动修正",
            `('000002',6,2,2,NULL)`,
            "000002",
            subject.ErrIncomplete,
        },
        {
            "负数",
            `('000002',2,-1,-1,NULL)`,
            "000002",
            subject.ErrIncomplete,
        },
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            file := filepath.Join(t.TempDir(), "db.sqlite")
            db, e := sql.Open("sqlite", file)
            if e != nil {
                t.Fatal(e)
            }

            _, e = db.Exec("CREATE TABLE atlas_schema_revisions(version TEXT PRIMARY KEY,type INTEGER,applied INTEGER,total INTEGER,error TEXT)")
            if e != nil {
                t.Fatal(e)
            }
            if c.rows != "" {
                if _, e = db.Exec("INSERT INTO atlas_schema_revisions VALUES " + c.rows); e != nil {
                    t.Fatal(e)
                }
            }
            db.Close()
            before, _ := os.ReadFile(file)
            g, e := subject.Open(context.Background(), "sqlite", "file:"+file+"?mode=ro&_pragma=query_only(1)", c.expected)
            if !errors.Is(e, c.want) {
                t.Fatalf("实际 %v 预期 %v", e, c.want)
            }
            if g != nil {
                if e = g.Check(context.Background()); e != nil {
                    t.Fatal(e)
                }
                g.Close()
            }

            after, _ := os.ReadFile(file)
            if string(before) != string(after) {
                t.Fatal("启动检查修改 SQLite 数据")
            }
        })
    }

    t.Run("缺表", func(t *testing.T) {
        g, e := subject.Open(context.Background(), "sqlite", ":memory:", "000002")
        if g != nil || !errors.Is(e, subject.ErrUnavailable) {
            t.Fatal(e)
        }
    })
    t.Run("取消上下文", func(t *testing.T) {
        ctx, cancel := context.WithCancel(context.Background())
        cancel()
        g, e := subject.Open(ctx, "sqlite", ":memory:", "000002")
        if g != nil || !errors.Is(e, subject.ErrUnavailable) {
            t.Fatal(e)
        }
    })
}
