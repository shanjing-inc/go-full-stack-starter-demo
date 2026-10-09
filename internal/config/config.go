// Package config 读取并校验应用各进程的启动环境配置。
package config

import (
    configbase "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/config"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "errors"
    "net"
    "net/url"
    "os"
    "regexp"
    "strconv"
    "strings"
    "time"

    worker "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
)

// Config 保存 Web 与 Worker 的显式启动配置、共享队列命名空间及历史保留期。
type Config struct {
    Worker                        worker.Config
    Address, Driver, DSN, Version string
    Origins                       []string
    Shutdown                      time.Duration
    QueueRecordRetention          time.Duration
    Development                   bool
    AuthSecret, BootstrapToken    string
}

var value = configbase.Value

// Load 按进程角色读取并校验环境变量；Web 额外要求认证密钥、监听地址与精确来源。
func Load(role string) (Config, error) {
    c := Config{Address: value("WEB_ADDR", "127.0.0.1:8080"), Version: value("DB_VERSION", "202610040001")}
    var err error
    c.Driver, c.DSN, err = database.ParseDSN(os.Getenv("DB_DSN"))
    if err != nil {
        return c, err
    }

    timeout, err := time.ParseDuration(value("SHUTDOWN_TIMEOUT", "4s"))
    if err != nil || timeout < time.Second || timeout > 30*time.Second {
        return c, errors.New("SHUTDOWN_TIMEOUT 范围为 1s–30s")
    }

    c.Shutdown = timeout
    days, err := strconv.Atoi(value("QUEUE_RECORD_RETENTION_DAYS", "7"))
    if err != nil || days < 1 || days > 365 {
        return c, errors.New("QUEUE_RECORD_RETENTION_DAYS 范围为 1–365")
    }

    c.QueueRecordRetention = time.Duration(days) * 24 * time.Hour
    c.Development = os.Getenv("APP_MODE") == "development"
    if mode := os.Getenv("APP_MODE"); mode != "development" && mode != "production" {
        return c, errors.New("APP_MODE 需要显式选择 development 或 production")
    }

    c.AuthSecret, c.BootstrapToken = os.Getenv("AUTH_SECRET"), os.Getenv("AUTH_BOOTSTRAP_TOKEN")
    if role == "web" && (len(c.AuthSecret) < 32 || (c.BootstrapToken != "" && len(c.BootstrapToken) < 32)) {
        return c, errors.New("认证密钥与初始化密钥至少需要 32 字节")
    }

    count, err := strconv.Atoi(value("WORKER_CONCURRENCY", "2"))
    if err != nil {
        return c, errors.New("WORKER_CONCURRENCY 无效")
    }
    // 默认 namespace 沿用既有 Redis 数据；工程名称调整保持队列与调度状态连续。
    c.Worker = worker.Config{
        RedisURL:        os.Getenv("REDIS_URL"),
        Namespace:       value("APP_NAMESPACE", "go-mysql-demo"),
        Instance:        value("INSTANCE_ID", role+"-1"),
        Concurrency:     count,
        ShutdownTimeout: timeout,
    }
    if err := c.Worker.Validate(); err != nil {
        return c, errors.New("Redis 或 Worker 配置无效")
    }
    if c.Version < "202610040001" {
        return c, errors.New("当前应用至少需要数据库版本 202610040001")
    }
    if !regexp.MustCompile(`^[0-9]{6,14}$`).MatchString(c.Version) {
        return c, errors.New("数据库配置无效")
    }
    if role == "web" {
        if _, _, err := net.SplitHostPort(c.Address); err != nil {
            return c, errors.New("WEB_ADDR 无效")
        }
    }

    for _, s := range strings.Split(os.Getenv("ALLOW_ORIGINS"), ",") {
        if s = strings.TrimSpace(s); s != "" {
            c.Origins = append(c.Origins, s)
        }
    }

    if role == "web" {
        if len(c.Origins) == 0 {
            return c, errors.New("Web 需要显式配置 ALLOW_ORIGINS")
        }

        for _, origin := range c.Origins {
            u, err := url.Parse(origin)
            if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Scheme != "http" && u.Scheme != "https") || (!c.Development && u.Scheme != "https") {
                return c, errors.New("ALLOW_ORIGINS 需要精确 origin，生产模式使用 HTTPS")
            }
        }
    }
    return c, nil
}
