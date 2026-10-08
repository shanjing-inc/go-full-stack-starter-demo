// Package lock 提供 Redis token 租约，续租与释放均原子校验持有者。
package lock

import (
    "context"
    "errors"
    "github.com/redis/go-redis/v9"
    "time"
)

// Lease 的续租与释放均校验随机持有者 token，并在 Redis 中原子执行。
type Lease struct {
    Redis *redis.Client
    Key   string
    Token string
    TTL   time.Duration
}

var renewScript = redis.NewScript(`
 local value=redis.call('GET',KEYS[1])
 if not value then return redis.call('SET',KEYS[1],ARGV[1],'PX',ARGV[2],'NX') and 1 or 0 end
 if value==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) end
 return 0
`)

var releaseScript = redis.NewScript(`
 if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end
 return 0
`)

func (l Lease) validate() error {
    if l.Redis == nil || l.Key == "" || l.Token == "" || l.TTL < time.Millisecond {
        return errors.New("租约需要客户端、键、持有者 token 和毫秒级正值 TTL")
    }
    return nil
}

// Acquire 原子获取租约或为相同持有者续期；其他持有者占用时返回 false。
func (l Lease) Acquire(ctx context.Context) (bool, error) {
    if err := l.validate(); err != nil {
        return false, err
    }

    n, e := renewScript.Run(ctx, l.Redis, []string{l.Key}, l.Token, l.TTL.Milliseconds()).Int()
    return n == 1, e
}

// Release 仅在当前 token 仍持有租约时删除键。
func (l Lease) Release(ctx context.Context) error {
    if err := l.validate(); err != nil {
        return err
    }
    return releaseScript.Run(ctx, l.Redis, []string{l.Key}, l.Token).Err()
}

// Owned 读取租约并比较持有者 token，租约缺失时返回 false, nil。
func (l Lease) Owned(ctx context.Context) (bool, error) {
    if err := l.validate(); err != nil {
        return false, err
    }

    v, e := l.Redis.Get(ctx, l.Key).Result()
    if errors.Is(e, redis.Nil) {
        return false, nil
    }
    return v == l.Token, e
}
