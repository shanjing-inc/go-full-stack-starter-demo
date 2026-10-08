// Package config 提供应用显式装配配置时使用的基础读取函数。
package config

import "os"

// Value 读取非空环境变量，变量缺失或为空时返回 fallback。
func Value(key, fallback string) string {
    if v := os.Getenv(key); v != "" {
        return v
    }
    return fallback
}
