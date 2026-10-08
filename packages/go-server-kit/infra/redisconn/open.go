// Package redisconn 将同一连接配置映射给 go-redis 与 Asynq。
package redisconn

import (
    "github.com/hibiken/asynq"
    "github.com/redis/go-redis/v9"
    "time"
)

// Open 解析 Redis URL 并统一客户端与 Asynq 的认证、数据库、TLS 和超时配置；连接探测由调用方执行。
func Open(url string) (*redis.Client, asynq.RedisClientOpt, error) {
    opt, err := redis.ParseURL(url)
    if err != nil {
        return nil, asynq.RedisClientOpt{}, err
    }

    opt.DialTimeout = time.Second
    opt.ReadTimeout = time.Second
    opt.WriteTimeout = time.Second
    opt.ContextTimeoutEnabled = true
    queue := asynq.RedisClientOpt{
        Network:      opt.Network,
        Addr:         opt.Addr,
        Username:     opt.Username,
        Password:     opt.Password,
        DB:           opt.DB,
        TLSConfig:    opt.TLSConfig,
        DialTimeout:  opt.DialTimeout,
        ReadTimeout:  opt.ReadTimeout,
        WriteTimeout: opt.WriteTimeout,
    }
    return redis.NewClient(opt), queue, nil
}
