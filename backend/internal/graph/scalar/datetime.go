// Package scalar 定义与现有协议兼容的标量编码。
package scalar

import (
    "fmt"
    "io"
    "strconv"
    "time"
)

// DateTime 输出秒级 UTC ISO 字符串，对齐参考项目 serializeDateTime。
type DateTime time.Time

// MarshalGQL 以 JSON 字符串输出秒级 UTC 时间。
func (d DateTime) MarshalGQL(w io.Writer) {
    fmt.Fprint(w, strconv.Quote(time.Time(d).UTC().Truncate(time.Second).Format(time.RFC3339)))
}

// UnmarshalGQL 接受携带明确时区的 RFC3339 时间字符串，保留输入的小数秒精度。
func (d *DateTime) UnmarshalGQL(v any) error {
    text, ok := v.(string)
    if !ok {
        return fmt.Errorf("DateTime 输入需要字符串")
    }

    parsed, err := time.Parse(time.RFC3339Nano, text)
    if err != nil {
        return fmt.Errorf("DateTime 输入需要明确时区")
    }

    *d = DateTime(parsed)
    return nil
}
