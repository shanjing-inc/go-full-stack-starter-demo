package config_test

// 本文件覆盖启动配置、显式开发模式及从 DSN 推导数据库类型。

import (
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/config"
    "testing"
    "time"
)

func TestConfig(t *testing.T) {
    t.Setenv("APP_MODE", "development")
    t.Setenv("AUTH_SECRET", "test-secret-with-at-least-32-bytes")
    t.Setenv("AUTH_BOOTSTRAP_TOKEN", "")
    t.Setenv("DB_VERSION", "202610040001")
    t.Setenv("ALLOW_ORIGINS", "https://localhost")
    t.Setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    t.Setenv("DB_DSN", "sqlite://sample.sqlite")
    t.Setenv("QUEUE_RECORD_RETENTION_DAYS", "")
    c, e := subject.Load("web")
    if e != nil {
        t.Fatal(e)
    }
    if c.QueueRecordRetention != 7*24*time.Hour {
        t.Fatal(c.QueueRecordRetention)
    }
    t.Run("支持的数据库方言", func(t *testing.T) {
        for driver, dsn := range map[string]string{
            "mysql":    "mysql://dev:password@localhost/demo",
            "postgres": "postgres://dev:password@localhost/demo",
            "sqlite":   "sqlite://sample.sqlite",
        } {
            t.Setenv("DB_DSN", dsn)
            c, err := subject.Load("web")
            if err != nil || c.Driver != driver {
                t.Fatalf("方言 %s: %v", driver, err)
            }
        }
    })
    t.Run("重命名后保留既有 Redis namespace", func(t *testing.T) {
        t.Setenv("APP_NAMESPACE", "")
        c, err := subject.Load("web")
        if err != nil || c.Worker.Namespace != "go-mysql-demo" {
            t.Fatalf("默认 namespace: %q, %v", c.Worker.Namespace, err)
        }
        t.Setenv("APP_NAMESPACE", "custom-deployment")
        c, err = subject.Load("web")
        if err != nil || c.Worker.Namespace != "custom-deployment" {
            t.Fatalf("显式 namespace: %q, %v", c.Worker.Namespace, err)
        }
    })
    t.Run("显式历史保留期", func(t *testing.T) {
        t.Setenv("QUEUE_RECORD_RETENTION_DAYS", "30")
        c, e := subject.Load("web")
        if e != nil || c.QueueRecordRetention != 30*24*time.Hour {
            t.Fatal(c, e)
        }
    })
    for _, item := range []struct{ key, value string }{
        {"QUEUE_RECORD_RETENTION_DAYS", "0"},
        {"QUEUE_RECORD_RETENTION_DAYS", "366"},
        {"QUEUE_RECORD_RETENTION_DAYS", "oops"},
        {"SHUTDOWN_TIMEOUT", "0s"},
        {"WORKER_CONCURRENCY", "0"},
        {"DB_DSN", "invalid://localhost/demo"},
        {"DB_DSN", ""},
        {"DB_VERSION", "oops"},
        {"WEB_ADDR", "invalid"},
        {"REDIS_URL", "secret-invalid"},
        {"AUTH_SECRET", "short"},
        {"AUTH_BOOTSTRAP_TOKEN", "short"},
        {"ALLOW_ORIGINS", "*"},
        {"ALLOW_ORIGINS", "https://localhost/path"},
        {"DB_VERSION", "202610030001"},
    } {
        t.Run(item.key, func(t *testing.T) {
            t.Setenv(item.key, item.value)
            if _, e := subject.Load("web"); e == nil {
                t.Fatal("无效配置应触发错误")
            }
        })
    }
}

func TestExplicitDevelopmentMode(t *testing.T) {
    t.Setenv("AUTH_SECRET", "test-secret-with-at-least-32-bytes")
    t.Setenv("AUTH_BOOTSTRAP_TOKEN", "")
    t.Setenv("DB_VERSION", "202610040001")
    t.Setenv("ALLOW_ORIGINS", "https://localhost")
    t.Setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    t.Setenv("DB_DSN", "sqlite://sample.sqlite")
    for _, mode := range []string{"", "production", "development"} {
        t.Run(mode, func(t *testing.T) {
            t.Setenv("APP_MODE", mode)
            _, err := subject.Load("web")
            if (err == nil) != (mode == "development" || mode == "production") {
                t.Fatalf("模式 %q: %v", mode, err)
            }
        })
    }
}

func TestDatabaseTypeComesFromDSN(t *testing.T) {
    t.Setenv("DB_DRIVER", "mysql")
    t.Setenv("DB_DSN", "postgresql://dev:password@localhost/demo")
    t.Setenv("APP_MODE", "development")
    t.Setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    t.Setenv("DB_VERSION", "202610040001")
    t.Setenv("WORKER_CONCURRENCY", "2")
    t.Setenv("SHUTDOWN_TIMEOUT", "4s")
    t.Setenv("QUEUE_RECORD_RETENTION_DAYS", "7")
    c, err := subject.Load("worker")
    if err != nil || c.Driver != "postgres" || c.DSN != "postgresql://dev:password@localhost/demo" {
        t.Fatal("数据库类型应来自连接 URL", err)
    }
}
