// Package jsonobject 提供协议入口共用的严格 JSON 对象解码。
package jsonobject

import (
    "bytes"
    "encoding/json"
    "errors"
    "io"
    "reflect"
    "strings"
    "unicode/utf8"
)

// Decode 将单个 UTF-8 JSON 对象解码到结构体指针，字段名严格匹配显式 json 标签。
func Decode(raw []byte, target any) error {
    if !utf8.Valid(raw) || len(bytes.TrimSpace(raw)) == 0 || bytes.TrimSpace(raw)[0] != '{' {
        return errors.New("JSON 需要有效对象")
    }

    var fields map[string]json.RawMessage
    if json.Unmarshal(raw, &fields) != nil || fields == nil {
        return errors.New("JSON 字段无效")
    }

    kind := reflect.TypeOf(target)
    if kind == nil || kind.Kind() != reflect.Pointer || kind.Elem().Kind() != reflect.Struct {
        return errors.New("JSON 目标需要结构体指针")
    }

    allowed := map[string]bool{}
    for i := 0; i < kind.Elem().NumField(); i++ {
        field := kind.Elem().Field(i)
        name := strings.Split(field.Tag.Get("json"), ",")[0]
        if name != "" && name != "-" {
            allowed[name] = true
        }
    }

    for key := range fields {
        if !allowed[key] {
            return errors.New("JSON 字段无效")
        }
    }

    d := json.NewDecoder(bytes.NewReader(raw))
    d.DisallowUnknownFields()
    if err := d.Decode(target); err != nil {
        return errors.New("JSON 字段无效")
    }

    var extra any
    if d.Decode(&extra) != io.EOF {
        return errors.New("JSON 需要单个对象")
    }
    return nil
}
