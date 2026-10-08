// Package queue 提供隔离队列的投递、消费和进程指标。
package queue

import (
    "context"
    "errors"
    "fmt"
    "regexp"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/redisconn"
    "github.com/hibiken/asynq"
    "github.com/redis/go-redis/v9"
)

// Observer 将执行观测接入现有入队与处理链路。
type Observer interface {
    Enqueued(context.Context, *asynq.TaskInfo) error
    Wrap(asynq.Handler) asynq.Handler
}

// Config 使用显式 namespace 隔离部署；Asynq 的内部 key 前缀由库维护。
type Config struct {
    RedisURL        string
    Namespace       string
    Instance        string
    Concurrency     int
    ShutdownTimeout time.Duration
    StrictPriority  bool
    Observer        Observer
}

var validName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,96}$`)

// Validate 校验命名空间、实例名、消费并发数、退出等待时间及 Redis URL。
func (c Config) Validate() error {
    if !validName.MatchString(c.Namespace) || !validName.MatchString(c.Instance) {
        return errors.New("namespace 与 instance 必须是 1–96 位字母、数字、横线或下划线")
    }
    if c.Concurrency < 1 || c.Concurrency > 32 {
        return errors.New("并发数范围为 1–32")
    }
    if c.ShutdownTimeout <= 0 {
        return errors.New("退出等待时间必须为正数")
    }

    _, err := redis.ParseURL(c.RedisURL)
    return err
}

// Queue 把逻辑队列名映射为当前部署的物理队列名。
func (c Config) Queue(logical string) string { return c.Namespace + "-" + logical }

// Key 为调度及观测元数据添加当前部署命名空间。
func (c Config) Key(name string) string { return c.Namespace + ":worker:" + name }

// Open 校验队列配置并创建共享 Redis 与 Asynq 客户端配置。
func Open(c Config) (*redis.Client, asynq.RedisClientOpt, error) {
    if err := c.Validate(); err != nil {
        return nil, asynq.RedisClientOpt{}, err
    }
    return redisconn.Open(c.RedisURL)
}

// NewServer 装配队列权重与可选观测包装并启动消费；调用方负责退出时关闭 Server。
func NewServer(c Config, opt asynq.RedisClientOpt, handler asynq.Handler) (*asynq.Server, error) {
    if err := c.Validate(); err != nil {
        return nil, err
    }

    server := asynq.NewServer(opt, asynq.Config{
        Concurrency: c.Concurrency,
        Queues:      map[string]int{c.Queue("critical"): 6, c.Queue("default"): 3, c.Queue("low"): 1},
        // 默认按权重消费；应用可显式启用严格优先级。
        StrictPriority:      c.StrictPriority,
        ShutdownTimeout:     c.ShutdownTimeout,
        HealthCheckInterval: 10 * time.Second,
    })
    if c.Observer != nil {
        handler = c.Observer.Wrap(handler)
    }
    if err := server.Start(handler); err != nil {
        return nil, fmt.Errorf("启动 Worker: %w", err)
    }
    return server, nil
}
