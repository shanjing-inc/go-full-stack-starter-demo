// Package bus 使用独立发布／订阅连接与现有 v1 Redis 信封，故障时关闭当前订阅。
package bus

import (
    "context"
    "encoding/hex"
    "encoding/json"
    "errors"
    "strings"
    "sync"
    "sync/atomic"
    "time"
    "unicode/utf8"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/internal/jsonobject"
    "github.com/google/uuid"
    "github.com/redis/go-redis/v9"
)

// ErrOverflow 表示消费速度落后于订阅缓冲容量，订阅随之结束。
var ErrOverflow = errors.New("订阅队列已满")

// ErrProtocol 表示信封或主题违反 v1 协议约束。
var ErrProtocol = errors.New("Bus 信封无效")

// ErrClosed 表示 Bus 已进入关闭状态。
var ErrClosed = errors.New("Bus 已关闭")

// Envelope 表示 v1 发布信封；时间为毫秒时间戳，Payload 保留原始 JSON。
type Envelope struct {
    Version          int             `json:"version"`
    ID               string          `json:"id"`
    Topic            string          `json:"topic"`
    PublishedAt      int64           `json:"publishedAt"`
    Payload          json.RawMessage `json:"payload"`
    SourceInstanceID string          `json:"sourceInstanceId,omitempty"`
}

// Decode 校验最多 64 KiB 的 v1 信封及字段约束，无效输入统一返回 ErrProtocol。
func Decode(raw []byte) (Envelope, error) {
    var message Envelope
    if len(raw) > 65536 || !validJSON(raw) || jsonobject.Decode(raw, &message) != nil {
        return message, ErrProtocol
    }

    var fields map[string]json.RawMessage
    _ = json.Unmarshal(raw, &fields)
    _, timestamp := fields["publishedAt"]
    _, source := fields["sourceInstanceId"]
    if message.Version != 1 || message.ID == "" || !utf8.ValidString(message.ID) || !validTopic(message.Topic) || !timestamp || string(fields["publishedAt"]) == "null" || message.PublishedAt < 0 || message.PublishedAt > 9007199254740991 || len(message.Payload) == 0 || (source && message.SourceInstanceID == "") {
        return message, ErrProtocol
    }
    return message, nil
}

func validTopic(topic string) bool {
    return topic != "" && utf8.ValidString(topic) && len(topic) <= 512
}

// Channel 将部署标识和主题编码为隔离频道，十六进制分段保留原始字符边界。
func Channel(prefix, environment, name, topic string) (string, error) {
    prefix = strings.Trim(strings.TrimSpace(prefix), ":")
    if prefix == "" || !utf8.ValidString(prefix) || len(prefix) > 128 || environment == "" || !utf8.ValidString(environment) || len(environment) > 128 || name == "" || !utf8.ValidString(name) || len(name) > 128 || !validTopic(topic) {
        return "", ErrProtocol
    }

    segment := func(s string) string { return hex.EncodeToString([]byte(s)) }
    return prefix + ":bus:pubsub:v1:" + segment(environment) + ":" + segment(name) + ":" + segment(topic), nil
}

// Config 配置部署命名空间、订阅缓冲与总配额及 Redis 操作超时；零配额使用默认值。
type Config struct {
    Prefix, Environment, Name, InstanceID string
    Queue, MaxSubscriptions               int
    OperationTimeout                      time.Duration
}

// Redis 管理借用客户端上的独立订阅连接和在线状态，内部互斥锁保护关闭与订阅登记。
type Redis struct {
    Client        *redis.Client
    config        Config
    mu            sync.Mutex
    closed        bool
    subscriptions map[*Subscription]struct{}
    active        atomic.Int64
}

// New 借用调用方的 Redis 客户端；Close 释放本 Bus 的订阅连接。
func New(client *redis.Client, config Config) (*Redis, error) {
    if client == nil {
        return nil, errors.New("Redis 客户端缺失")
    }
    if config.Queue == 0 {
        config.Queue = 8
    }
    if config.MaxSubscriptions == 0 {
        config.MaxSubscriptions = 128
    }
    if config.OperationTimeout == 0 {
        config.OperationTimeout = time.Second
    }
    if config.Queue < 1 || config.Queue > 128 || config.MaxSubscriptions < 1 || config.MaxSubscriptions > 1024 || config.OperationTimeout <= 0 {
        return nil, errors.New("Bus 配额无效")
    }
    if _, err := Channel(config.Prefix, config.Environment, config.Name, "presence"); err != nil {
        return nil, err
    }
    return &Redis{
        Client:        client,
        config:        config,
        subscriptions: make(map[*Subscription]struct{}),
    }, nil
}

// Channel 使用本实例配置生成隔离频道。
func (b *Redis) Channel(topic string) (string, error) {
    return Channel(b.config.Prefix, b.config.Environment, b.config.Name, topic)
}

// Active 返回当前已登记的订阅数量，包含订阅握手阶段。
func (b *Redis) Active() int64 { return b.active.Load() }

// Publish 编码并发布 v1 信封，成功返回消息 ID；业务送达由应用回执确认。
func (b *Redis) Publish(ctx context.Context, topic string, payload any) (string, error) {
    b.mu.Lock()
    closed := b.closed
    b.mu.Unlock()
    if closed {
        return "", ErrClosed
    }

    channel, err := b.Channel(topic)
    if err != nil {
        return "", err
    }

    raw, err := json.Marshal(payload)
    if err != nil {
        return "", ErrProtocol
    }

    message := Envelope{
        Version:          1,
        ID:               uuid.NewString(),
        Topic:            topic,
        PublishedAt:      time.Now().UnixMilli(),
        Payload:          raw,
        SourceInstanceID: b.config.InstanceID,
    }
    encoded, err := json.Marshal(message)
    if err != nil || len(encoded) > 65536 || !validJSON(encoded) {
        return "", ErrProtocol
    }

    operation, cancel := context.WithTimeout(ctx, b.config.OperationTimeout)
    defer cancel()
    // Redis subscriber count 仅表示订阅连接；业务回执和在线状态分别验证。
    if err = b.Client.Publish(operation, channel, encoded).Err(); err != nil {
        return "", errors.New("Bus 发布失败")
    }
    return message.ID, nil
}

// Subscription 通过 Messages 提供消息，通过 Done 通知订阅结束；结束原因由 Err 读取。
type Subscription struct {
    Messages chan Envelope
    Done     chan struct{}
    mu       sync.Mutex
    err      error
    cancel   context.CancelFunc
}

// Err 读取订阅终止原因，正常取消时结果可为空。
func (s *Subscription) Err() error {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.err
}

func (s *Subscription) setError(err error) {
    s.mu.Lock()
    s.err = err
    s.mu.Unlock()
}

// Close 取消订阅并等待接收协程清理完成。
func (s *Subscription) Close() {
    s.cancel()
    <-s.Done
}

// Subscribe 确认 Redis 订阅握手后开始接收；协议错误、中断及缓冲溢出均终止该订阅。
func (b *Redis) Subscribe(ctx context.Context, topic string) (*Subscription, error) {
    channel, err := b.Channel(topic)
    if err != nil {
        return nil, err
    }

    child, cancel := context.WithCancel(ctx)
    s := &Subscription{
        Messages: make(chan Envelope, b.config.Queue),
        Done:     make(chan struct{}),
        cancel:   cancel,
    }
    b.mu.Lock()
    if b.closed || len(b.subscriptions) >= b.config.MaxSubscriptions {
        b.mu.Unlock()
        cancel()
        return nil, errors.New("Bus 订阅配额已满或已关闭")
    }

    b.subscriptions[s] = struct{}{}
    b.active.Add(1)
    b.mu.Unlock()
    pubsub := b.Client.Subscribe(child, channel)
    stop := context.AfterFunc(child, func() { _ = pubsub.Close() })
    cleanup := func() {
        cancel()
        stop()
        _ = pubsub.Close()
        b.mu.Lock()
        delete(b.subscriptions, s)
        b.active.Add(-1)
        b.mu.Unlock()
        close(s.Done)
    }
    ack, err := pubsub.ReceiveTimeout(child, b.config.OperationTimeout)
    confirmation, ok := ack.(*redis.Subscription)
    if err != nil || !ok || confirmation.Kind != "subscribe" || confirmation.Channel != channel {
        cleanup()
        return nil, errors.New("Redis 订阅确认失败")
    }
    go func() {
        defer cleanup()
        for {
            value, err := pubsub.Receive(child)
            if err != nil {
                if child.Err() == nil {
                    s.setError(errors.New("Redis 订阅中断"))
                }
                return
            }

            message, ok := value.(*redis.Message)
            if !ok {
                s.setError(errors.New("Redis 订阅连接发生变更"))
                return
            }

            envelope, err := Decode([]byte(message.Payload))
            if err != nil || message.Channel != channel || envelope.Topic != topic {
                s.setError(ErrProtocol)
                return
            }

            select {
            case <-child.Done():
                return
            case s.Messages <- envelope:
            default:
                s.setError(ErrOverflow)
                return
            }
        }
    }()
    return s, nil
}

// Close 关闭全部订阅并等待清理完成，底层借用客户端由调用方释放。
func (b *Redis) Close() {
    b.mu.Lock()
    b.closed = true
    all := make([]*Subscription, 0, len(b.subscriptions))
    for s := range b.subscriptions {
        all = append(all, s)
    }

    b.mu.Unlock()
    for _, s := range all {
        s.cancel()
    }

    for _, s := range all {
        <-s.Done
    }
}

// PresenceKey 返回当前部署的在线成员集合键。
func (b *Redis) PresenceKey() string {
    channel, _ := b.Channel("presence")
    return channel + ":presence"
}

// PresenceRefresh 使用 Redis 服务端时间原子刷新成员到期时间，ttl 按毫秒计算。
func (b *Redis) PresenceRefresh(ctx context.Context, id string, ttl time.Duration) error {
    operation, cancel := context.WithTimeout(ctx, b.config.OperationTimeout)
    defer cancel()
    return b.Client.Eval(operation, `local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000); redis.call('ZADD',KEYS[1],now+ARGV[2],ARGV[1]); return 1`, []string{b.PresenceKey()}, id, ttl.Milliseconds()).Err()
}

// PresenceRemove 尽力移除成员在线标记，失败由到期清理收敛。
func (b *Redis) PresenceRemove(ctx context.Context, id string) {
    operation, cancel := context.WithTimeout(ctx, b.config.OperationTimeout)
    defer cancel()
    _ = b.Client.ZRem(operation, b.PresenceKey(), id).Err()
}

// PresenceCount 使用 Redis 服务端时间原子清理过期成员并返回在线数量。
func (b *Redis) PresenceCount(ctx context.Context) (int64, error) {
    operation, cancel := context.WithTimeout(ctx, b.config.OperationTimeout)
    defer cancel()
    // 使用 Redis 服务端时间原子清理并计数，避免各 Web 宿主机时钟差影响在线状态。
    count, err := b.Client.Eval(operation, `local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000); redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now); return redis.call('ZCARD',KEYS[1])`, []string{b.PresenceKey()}).Int64()
    if err != nil {
        return 0, errors.New("在线成员状态读取失败")
    }
    return count, nil
}
