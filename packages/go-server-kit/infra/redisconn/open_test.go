package redisconn_test

// 本文件覆盖Redis TLS 配置与 Asynq 连接参数的一致性。

import (
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/redisconn"
    "testing"
)

func TestTLS(t *testing.T) {
    c, opt, err := subject.Open("rediss://user:secret@localhost:6380/2")
    if err != nil {
        t.Fatal(err)
    }
    defer c.Close()
    if opt.TLSConfig == nil || opt.Username != "user" || opt.DB != 2 {
        t.Fatal("TLS 或 ACL 配置丢失")
    }
}
