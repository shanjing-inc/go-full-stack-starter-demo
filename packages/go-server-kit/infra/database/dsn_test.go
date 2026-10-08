package database_test

// 本文件覆盖统一连接 URL、MySQL 与 SQLite 参数转换，以及错误消息的秘密信息保护。

import (
    "encoding/json"
    "os"
    "strings"
    "testing"
    "time"

    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    mysqldriver "github.com/go-sql-driver/mysql"
)

func TestConnectionURLContract(t *testing.T) {
    raw, err := os.ReadFile("testdata/connection_urls.json")
    if err != nil {
        t.Fatal(err)
    }

    var cases []struct{ Name, URL, Driver string }
    if err := json.Unmarshal(raw, &cases); err != nil {
        t.Fatal(err)
    }

    for _, item := range cases {
        t.Run(item.Name, func(t *testing.T) {
            driver, dsn, err := subject.ParseDSN(item.URL)
            if item.Driver == "" {
                if err == nil || driver != "" || dsn != "" {
                    t.Fatal("无效 URL 应返回错误和空结果")
                }
                if strings.Contains(err.Error(), "password") {
                    t.Fatal("错误应隐藏连接凭据")
                }
                return
            }
            if err != nil || driver != item.Driver || dsn == "" {
                t.Fatalf("方言 %s: %v", driver, err)
            }
            if driver == "postgres" && dsn != strings.ToLower(strings.SplitN(item.URL, ":", 2)[0])+":"+strings.SplitN(item.URL, ":", 2)[1] {
                t.Fatal("PostgreSQL URL 应保留原参数")
            }
        })
    }
}

func TestMySQLURLConversion(t *testing.T) {
    _, dsn, err := subject.ParseDSN("mysql://dev:p%40%3A%2F%3F%23%25@[::1]:3307/demo?timeout=2s&readTimeout=3s&writeTimeout=4s&loc=Asia%2FShanghai&charset=utf8mb4")
    if err != nil {
        t.Fatal(err)
    }

    cfg, err := mysqldriver.ParseDSN(dsn)
    if err != nil {
        t.Fatal(err)
    }
    if cfg.User != "dev" || cfg.Passwd != "p@:/?#%" || cfg.Net != "tcp" || cfg.Addr != "[::1]:3307" || cfg.DBName != "demo" || !cfg.ParseTime || cfg.Loc.String() != "Asia/Shanghai" || cfg.Timeout != 2*time.Second || cfg.ReadTimeout != 3*time.Second || cfg.WriteTimeout != 4*time.Second || cfg.Params["charset"] != "utf8mb4" {
        t.Fatal("MySQL URL 转换丢失配置")
    }

    _, dsn, err = subject.ParseDSN("mysql://dev:password@localhost/demo")
    if err != nil {
        t.Fatal(err)
    }

    cfg, err = mysqldriver.ParseDSN(dsn)
    if err != nil || cfg.Addr != "localhost:3306" || !cfg.ParseTime || cfg.Loc != time.UTC {
        t.Fatal("MySQL 默认端口与时间配置无效")
    }

    _, dsn, err = subject.ParseDSN("mysql://dev:password@localhost/demo?parseTime=false")
    if err != nil {
        t.Fatal(err)
    }

    cfg, err = mysqldriver.ParseDSN(dsn)
    if err != nil || cfg.ParseTime {
        t.Fatal("显式连接参数应保留")
    }
}

func TestSQLiteURLConversion(t *testing.T) {
    cases := map[string]string{
        "sqlite:///tmp/demo.sqlite": "/tmp/demo.sqlite",
        "sqlite://demo.sqlite":      "demo.sqlite",
        "sqlite:///:memory:":        ":memory:",
        "sqlite:///tmp/demo%20test.sqlite?_pragma=busy_timeout%285000%29": "/tmp/demo test.sqlite?_pragma=busy_timeout%285000%29",
    }
    for raw, expected := range cases {
        _, dsn, err := subject.ParseDSN(raw)
        if err != nil || dsn != expected {
            t.Fatalf("SQLite URL 转换: %v", err)
        }
    }
}

func TestMySQLURLParameterErrorsHideSecrets(t *testing.T) {
    for _, parameter := range []string{
        "timeout=secret-invalid",
        "parseTime=secret-invalid",
        "loc=secret-invalid",
    } {
        driver, dsn, err := subject.ParseDSN("mysql://dev:secret-password@localhost/demo?" + parameter)
        if err == nil || driver != "" || dsn != "" || strings.Contains(err.Error(), "secret-") {
            t.Fatal("错误需要隐藏原始参数与连接凭据")
        }
    }
}
