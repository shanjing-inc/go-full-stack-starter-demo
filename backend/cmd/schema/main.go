// Package main 导出应用组合模型的目标方言 Schema。
package main

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/schema"
    "flag"
    "fmt"
    "os"
)

// main 读取目标方言并向标准输出导出 Schema，错误通过退出码和标准错误报告。
func main() {
    dialect := flag.String("dialect", "mysql", "mysql、postgres 或 sqlite")
    flag.Parse()
    sql, err := schema.Export(*dialect)
    if err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
    fmt.Print(sql)
}
