// format-go 使用 Go AST 将代码统一为四空格，保留字符串字面值。
package main

import (
    "bytes"
    "flag"
    "fmt"
    "go/format"
    "go/parser"
    "go/printer"
    "go/token"
    "io"
    "os"
)

// formatted 使用 Go 语法解析与四空格打印整理源码，并复验标准格式往返一致性。
func formatted(source []byte) ([]byte, error) {
    canonical, err := format.Source(source)
    if err != nil {
        return nil, err
    }

    set := token.NewFileSet()
    file, err := parser.ParseFile(set, "", canonical, parser.ParseComments|parser.SkipObjectResolution)
    if err != nil {
        return nil, err
    }

    var output bytes.Buffer
    config := printer.Config{Mode: printer.UseSpaces, Tabwidth: 4}
    if err := config.Fprint(&output, set, file); err != nil {
        return nil, err
    }
    // 重新规范化后必须相同，保护原始字符串、注释和协议样本。
    roundTrip, err := format.Source(output.Bytes())
    if err != nil {
        return nil, err
    }
    if !bytes.Equal(canonical, roundTrip) {
        return nil, fmt.Errorf("四空格格式化的规范化校验失败")
    }
    return output.Bytes(), nil
}

// formatStream 为编辑器提供标准输入／输出格式化，保留字符串字面值。
func formatStream(input io.Reader, output io.Writer) error {
    source, err := io.ReadAll(input)
    if err != nil {
        return err
    }

    result, err := formatted(source)
    if err != nil {
        return err
    }

    _, err = output.Write(result)
    return err
}

// run 按文件顺序检查或写入格式结果；检查模式输出差异路径并返回失败状态。
func run(paths []string, check bool) (bool, error) {
    changed := false
    for _, path := range paths {
        source, err := os.ReadFile(path)
        if err != nil {
            return false, err
        }

        output, err := formatted(source)
        if err != nil {
            return false, fmt.Errorf("%s: %w", path, err)
        }
        if bytes.Equal(source, output) {
            continue
        }

        changed = true
        if check {
            fmt.Println(path)
        } else if err := os.WriteFile(path, output, 0644); err != nil {
            return false, err
        }
    }

    return changed, nil
}

// main 解析检查模式与文件参数，无文件时按标准输入输出运行四空格格式化。
func main() {
    check := flag.Bool("check", false, "检查四空格格式，仅输出需要调整的文件")
    flag.Parse()
    if flag.NArg() == 0 {
        if *check {
            fmt.Fprintln(os.Stderr, "检查模式需要提供文件路径")
            os.Exit(1)
        }
        if err := formatStream(os.Stdin, os.Stdout); err != nil {
            fmt.Fprintln(os.Stderr, err)
            os.Exit(1)
        }
        return
    }

    changed, err := run(flag.Args(), *check)
    if err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
    if *check && changed {
        os.Exit(1)
    }
}
