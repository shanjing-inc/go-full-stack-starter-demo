// Package cache 使用显式命名空间提供 JSON 缓存与正值 TTL。
package cache

import (
    "context"
    "encoding/json"
    "errors"
    "github.com/redis/go-redis/v9"
    "time"
)

// Store 使用借用的 Redis 客户端和显式前缀存储 JSON 缓存。
type Store struct {
    Redis  *redis.Client
    Prefix string
}

// Set 将值编码为 JSON 写入隔离键，要求正值 TTL。
func (s Store) Set(ctx context.Context, key string, value any, ttl time.Duration) error {
    if s.Redis == nil || key == "" || s.Prefix == "" || ttl <= 0 {
        return errors.New("缓存需要命名空间、键和正值 TTL")
    }

    raw, err := json.Marshal(value)
    if err != nil {
        return err
    }
    return s.Redis.Set(ctx, s.Prefix+":"+key, raw, ttl).Err()
}

// Get 把命中值解码到 dest；缓存缺失返回 false, nil。
func (s Store) Get(ctx context.Context, key string, dest any) (bool, error) {
    if s.Redis == nil || s.Prefix == "" || key == "" {
        return false, errors.New("缓存需要客户端、命名空间和键")
    }

    raw, err := s.Redis.Get(ctx, s.Prefix+":"+key).Bytes()
    if errors.Is(err, redis.Nil) {
        return false, nil
    }
    if err != nil {
        return false, err
    }

    err = json.Unmarshal(raw, dest)
    return err == nil, err
}

// Delete 按前缀删除缓存键，重复删除保持幂等。
func (s Store) Delete(ctx context.Context, key string) error {
    if s.Redis == nil || s.Prefix == "" || key == "" {
        return errors.New("缓存需要客户端、命名空间和键")
    }
    return s.Redis.Del(ctx, s.Prefix+":"+key).Err()
}
