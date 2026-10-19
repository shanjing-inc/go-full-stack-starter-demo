package main

// 本文件覆盖四空格布局、字面值保持、无效源码拒绝及检查、写入和流模式。

import (
    "bytes"
    "os"
    "path/filepath"
    "testing"
)

func TestFormatted(t *testing.T) {
    source := []byte("package demo\n\nfunc count() int {\n\tif true {\n\t\treturn 1\n\t}\n\treturn 0\n}\n")
    output, err := formatted(source)
    if err != nil {
        t.Fatal(err)
    }
    if bytes.Contains(output, []byte("\t")) || !bytes.Contains(output, []byte("\n        return 1")) {
        t.Fatalf("四空格缩进错误: %s", output)
    }

    again, err := formatted(output)
    if err != nil || !bytes.Equal(output, again) {
        t.Fatalf("格式化应幂等: %v", err)
    }
}

func TestPreserveLiterals(t *testing.T) {
    literal := "`第一行\n\t协议原始缩进\n  第二行`"
    source := []byte("//go:build linux\n\npackage demo\n\n// 原始字符串用于协议样本。\nconst payload = " + literal + "\nconst escaped = \"\\t\\n\"\n")
    output, err := formatted(source)
    if err != nil {
        t.Fatal(err)
    }

    for _, expected := range []string{
        literal,
        "//go:build linux",
        "// 原始字符串用于协议样本。",
        `"\t\n"`,
    } {
        if !bytes.Contains(output, []byte(expected)) {
            t.Fatalf("格式化应保留 %q: %s", expected, output)
        }
    }
}

func TestRejectInvalidSource(t *testing.T) {
    if _, err := formatted([]byte("package demo\nfunc (")); err == nil {
        t.Fatal("无效 Go 源码应返回错误")
    }
}

func TestCheckAndWrite(t *testing.T) {
    path := filepath.Join(t.TempDir(), "sample.go")
    source := []byte("package demo\nfunc f(){\n\tprintln(1)\n}\n")
    if err := os.WriteFile(path, source, 0644); err != nil {
        t.Fatal(err)
    }

    changed, err := run([]string{path}, true)
    if err != nil || !changed {
        t.Fatalf("检查应识别格式差异: %v", err)
    }

    after, err := os.ReadFile(path)
    if err != nil || !bytes.Equal(source, after) {
        t.Fatalf("只读检查应保留原文件: %v", err)
    }
    if changed, err = run([]string{path}, false); err != nil || !changed {
        t.Fatalf("写入格式失败: %v", err)
    }
    if changed, err = run([]string{path}, true); err != nil || changed {
        t.Fatalf("写入后检查失败: %v", err)
    }
}

func TestFormatStream(t *testing.T) {
    source := []byte("package demo\nfunc f(){\n\tprintln(1)\n}\n")
    var output bytes.Buffer
    if err := formatStream(bytes.NewReader(source), &output); err != nil {
        t.Fatal(err)
    }
    if !bytes.Contains(output.Bytes(), []byte("\n    println(1)")) || bytes.Contains(output.Bytes(), []byte("\t")) {
        t.Fatalf("编辑器输出应为四空格: %s", output.Bytes())
    }

    expected, err := formatted(source)
    if err != nil || !bytes.Equal(expected, output.Bytes()) {
        t.Fatalf("编辑器与文件格式应一致: %v", err)
    }
}

func TestFormatStreamRejectsInvalidSource(t *testing.T) {
    var output bytes.Buffer
    if err := formatStream(bytes.NewReader([]byte("package demo\nfunc (")), &output); err == nil {
        t.Fatal("编辑器的无效 Go 缓冲区应返回错误")
    }
    if output.Len() != 0 {
        t.Fatal("格式化失败时应保留原缓冲区")
    }
}
