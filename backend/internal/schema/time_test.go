package schema_test

import (
    "context"
    "os"
    "path/filepath"
    "strings"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
)

func TestSQLiteTimeMigration(t *testing.T) {
    for _, invalidValue := range []string{
        "", "2026-10-21T04:00:00garbageZ", "2026-10-21 04:00garbage", "2026-10-21garbage",
        "2026-02-30", "2026-02-30Z", "2026-02-30 04:00", "2026-02-30T04:00Z",
        "2026-02-30 04:00:00", "2026-02-30T04:00:00+08:00", "2026-02-30 04:00:00 +0800 CST",
        "1900-02-29T04:00:00Z", "2026-04-31 04:00:00", "2026-10-21 24:00:00",
        "2026-10-21T24:00Z", "2026-10-21 04:60:00", "2026-10-21T04:00:60Z",
        "2026-10-21T04:00:00,Z", "2026-10-21T04:00:00,abcZ", "2026-10-21T04:00:00,123,456Z",
        "2026-02-30T04:00:00,123Z", "2026-10-21T24:00:00,123Z", "2026-10-21T04:00:60,123Z",
        "2026-02-30 4:00:00 +0800 CST", "2026-10-21T4:60:00Z", "2026-10-21T4:00:60Z",
        "2026-10-21T4:00:00,abcZ", "2026-10-21T4:00:00,123,456Z", "2026-10-21 004:00:00",
        "2026-10-21T4:0Z", "2026-10-21T4:00:0Z", "2026-10-21T4:00:00garbageZ",
        "2026-02-30T04:00:00+08:00Z", "2026-10-21T24:00:00+00:00Z", "2026-10-21T04:00:00+00:00ZZ",
    } {
        invalid := invalidValue != ""
        name := "保留绝对时间与默认值"
        if invalid {
            name = "拒绝不可解析的历史值/" + invalidValue
        }
        t.Run(name, func(t *testing.T) {
            db, err := database.Open(context.Background(), "sqlite", filepath.Join(t.TempDir(), "legacy.sqlite")+"?_pragma=foreign_keys(1)")
            if err != nil {
                t.Fatal(err)
            }
            pool, _ := db.DB()
            defer pool.Close()
            apply := func(name string) error {
                data, err := os.ReadFile("../../migrations/sqlite/" + name)
                if err != nil {
                    return err
                }
                tx, err := pool.Begin()
                if err != nil {
                    return err
                }
                if _, err := tx.Exec(string(data)); err != nil {
                    _ = tx.Rollback()
                    return err
                }
                return tx.Commit()
            }
            for _, name := range []string{"202610030001_initial.sql", "202610040001_email_auth.sql"} {
                if err := apply(name); err != nil {
                    t.Fatal(err)
                }
            }
            if _, err := pool.Exec("INSERT INTO user (id,name,email,ban_expires) VALUES (1,'旧用户','old@example.com',NULL)"); err != nil {
                t.Fatal(err)
            }
            old := "2026-10-21 12:00:00.999999999 +0800 CST"
            if invalid {
                old = invalidValue
            }
            if _, err := pool.Exec("INSERT INTO shop (id,name,slug,status,created_at,updated_at) VALUES (1,'旧店铺','legacy','active',?,?)", old, "2026-10-21T04:00:00.999999999Z"); err != nil {
                t.Fatal(err)
            }
            type historicalTime struct {
                value   any
                seconds int64
            }
            cases := []historicalTime{
                {"2026-10-21T12:00:00.999999999+08:00", 1792555200},
                {"2026-10-20 21:00:00.999999999 -0700 PDT", 1792555200},
                {"2026-10-21T12:00:00+0800", 1792555200},
                {"1969-12-31T23:59:59.999999999Z", -1},
                {int64(-1), -1},
                {"2026-10-21 04:00:00", 1792555200},
                {"2026-10-21", 1792540800},
                {"2026-10-21 04:00", 1792555200},
                {"2026-10-21T04:00", 1792555200},
                {"2026-10-21Z", 1792540800},
                {"2026-10-21 04:00Z", 1792555200},
                {"2026-10-21T04:00Z", 1792555200},
                {"2024-02-29T00:30:00+08:00", 1709137800},
                {"2000-02-29Z", 951782400},
                {"1969-12-31", -86400},
                {"1969-12-31T23:59", -60},
                {"2026-10-21 04:00:00.1 +0000 UTC m=+1.23", 1792555200},
            }
            legacyStart := len(cases)
            // 同时覆盖旧文本解析器的格式、单数字小时、点／逗号小数秒和 Z 后缀。
            for _, layout := range []string{
                "2006-01-02 15:04:05.999999999-07:00",
                "2006-01-02T15:04:05.999999999-07:00",
                "2006-01-02 15:04:05.999999999",
                "2006-01-02T15:04:05.999999999",
                "2006-01-02 15:04:05.999999999 -0700 MST",
                "2006-01-02 15:04",
                "2006-01-02T15:04",
                "2006-01-02",
            } {
                for _, instant := range []time.Time{
                    time.Date(2026, 10, 21, 4, 0, 0, 999999999, time.UTC),
                    time.Date(2026, 10, 21, 12, 0, 0, 123000000, time.FixedZone("CST", 8*3600)),
                    time.Date(2026, 10, 21, 4, 0, 0, 123000000, time.FixedZone("CST", 8*3600)),
                    time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC),
                    time.Date(1969, 12, 31, 23, 59, 59, 999999999, time.UTC),
                } {
                    for _, separator := range []string{".", ","} {
                        format := strings.Replace(layout, ".", separator, 1)
                        value := instant.Format(format)
                        parsed, err := time.Parse(format, value)
                        if err != nil {
                            t.Fatal(err)
                        }
                        variants := []string{value}
                        if len(value) > 12 && value[11] == '0' {
                            variants = append(variants, value[:11]+value[12:])
                        }
                        for _, variant := range variants {
                            cases = append(cases, historicalTime{variant, parsed.Unix()})
                            if !strings.Contains(layout, "MST") {
                                cases = append(cases, historicalTime{variant + "Z", parsed.Unix()})
                            }
                        }
                    }
                }
            }
            if invalid {
                // 每个非法场景仅保留当前样本，避免其他格式掩盖失败原因。
                cases = nil
            }
            for i, item := range cases {
                if _, err := pool.Exec("INSERT INTO shop (id,name,slug,status,created_at,updated_at) VALUES (?,'边界',?,'active',?,?)", i+2, i+2, item.value, item.value); err != nil {
                    t.Fatal(err)
                }
                if i >= legacyStart {
                    // 在迁移前走实际驱动的 TEXT 解码，防止只按 Go 布局生成 fixture 而漏掉宽松解析。
                    var legacy time.Time
                    if err := pool.QueryRow("SELECT created_at FROM shop WHERE id=?", i+2).Scan(&legacy); err != nil || legacy.Unix() != item.seconds {
                        t.Fatal("历史文本必须能被驱动按预期读取", item.value, legacy, err)
                    }
                }
            }
            if _, err := pool.Exec("INSERT INTO session (id,user_id,token,expires_at) VALUES (10,1,'kept','2026-10-22T00:00:00Z')"); err != nil {
                t.Fatal(err)
            }
            // 已删除的最大 ID 仍须保留，避免重建表后复用历史编号。
            if _, err := pool.Exec("INSERT INTO session (id,user_id,token,expires_at) VALUES (50,1,'deleted','2026-10-22T00:00:00Z'); DELETE FROM session WHERE id=50;"); err != nil {
                t.Fatal(err)
            }
            err = apply("202610210001_time.sql")
            if invalid {
                if err == nil || !strings.Contains(err.Error(), "CHECK constraint") {
                    t.Fatal("无效历史值必须由迁移约束拒绝", err)
                }
                var stored string
                if err := pool.QueryRow("SELECT created_at FROM shop WHERE id=1").Scan(&stored); err != nil || stored != invalidValue {
                    t.Fatal("失败后应保留原值", err)
                }
                return
            }
            if err != nil {
                t.Fatal(err)
            }
            var row struct{ CreatedAt, UpdatedAt time.Time }
            if err := db.Table("shop").Where("id=1").Take(&row).Error; err != nil {
                t.Fatal(err)
            }
            expected := time.Date(2026, 10, 21, 4, 0, 0, 0, time.UTC)
            if !row.CreatedAt.Equal(expected) || !row.UpdatedAt.Equal(expected) {
                t.Fatalf("历史值应按 offset 转成秒级绝对时间：%+v", row)
            }
            for i, item := range cases {
                var seconds int64
                if err := pool.QueryRow("SELECT CAST(created_at AS INTEGER) FROM shop WHERE id=?", i+2).Scan(&seconds); err != nil || seconds != item.seconds {
                    t.Fatal("历史格式或负纪元截断错误", item.value, seconds, err)
                }
            }
            if _, err := pool.Exec("INSERT INTO session (user_id,token,expires_at) VALUES (1,'new',unixepoch()+3600)"); err != nil {
                t.Fatal(err)
            }
            var id int
            var kind string
            if err := pool.QueryRow("SELECT id,typeof(created_at) FROM session WHERE token='new'").Scan(&id, &kind); err != nil || id <= 50 || kind != "integer" {
                t.Fatal("默认值或历史序列丢失", id, kind, err)
            }
            var violations int
            if err := pool.QueryRow("SELECT count(*) FROM pragma_foreign_key_check").Scan(&violations); err != nil || violations != 0 {
                t.Fatal("外键关系不应改变", err)
            }
            var kept int
            if err := pool.QueryRow("SELECT count(*) FROM session WHERE id=10 AND typeof(expires_at)='integer'").Scan(&kept); err != nil || kept != 1 {
                t.Fatal("关联会话必须保留", err)
            }
        })
    }
}
