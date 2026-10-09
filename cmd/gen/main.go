// Package main 生成应用模型的类型化数据库查询。
package main

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/model"
    "gorm.io/gen"
)

// main 基于组合模型生成类型化查询，输出路径相对于应用模块工作目录。
func main() {
    g := gen.NewGenerator(gen.Config{OutPath: "internal/query", Mode: gen.WithDefaultQuery | gen.WithQueryInterface})
    g.ApplyBasic(model.Models()...)
    g.Execute()
}
