package config_test

import (
    "reflect"
    "testing"

    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/config"
)

func TestOriginModes(t *testing.T) {
    for key, value := range map[string]string{
        "AUTH_SECRET": "test-secret-with-at-least-32-bytes", "AUTH_BOOTSTRAP_TOKEN": "",
        "DB_DSN": "sqlite://sample.sqlite", "DB_VERSION": "202610210001",
        "REDIS_URL": "redis://127.0.0.1:6379/0", "WEB_ADDR": "127.0.0.1:8080",
        "SHUTDOWN_TIMEOUT": "4s", "QUEUE_RECORD_RETENTION_DAYS": "7", "WORKER_CONCURRENCY": "2",
    } {
        t.Setenv(key, value)
    }
    for _, item := range []struct {
        name, mode, rules string
        valid             bool
    }{
        {"开发本地通配", "development", "http://localhost:*,http://127.0.0.1:*", true},
        {"开发HTTPS通配", "development", "https://localhost:*,https://127.0.0.1:*", true},
        {"开发混用", "development", " http://localhost:* , https://app.example:8443 ", true},
        {"开发精确IPv6", "development", "http://[::1]:8080", true},
        {"生产精确HTTPS", "production", "https://app.example", true},
        {"生产HTTP通配", "production", "http://localhost:*", false},
        {"生产HTTPS通配", "production", "https://localhost:*", false},
        {"生产混入通配", "production", "https://app.example,https://127.0.0.1:*", false},
        {"生产精确HTTP", "production", "http://localhost:8080", false},
        {"任意来源", "development", "*", false},
        {"远程通配", "development", "http://app.example:*", false},
        {"相似域名", "development", "http://localhost.example:*", false},
        {"IPv6通配", "development", "http://[::1]:*", false},
        {"省略协议", "development", "localhost:*", false},
        {"通配带路径", "development", "http://localhost:*/path", false},
        {"无效端口", "development", "http://localhost:65536", false},
        {"空查询串", "development", "http://localhost?", false},
    } {
        t.Run(item.name, func(t *testing.T) {
            t.Setenv("APP_MODE", item.mode)
            t.Setenv("ALLOW_ORIGINS", item.rules)
            c, err := subject.Load("web")
            if (err == nil) != item.valid {
                t.Fatalf("配置 %q，模式 %q：%v", item.rules, item.mode, err)
            }
            if item.name == "开发混用" && !reflect.DeepEqual(c.Origins, []string{"http://localhost:*", "https://app.example:8443"}) {
                t.Fatalf("来源规则应保持顺序并清理空白：%v", c.Origins)
            }
        })
    }
}
