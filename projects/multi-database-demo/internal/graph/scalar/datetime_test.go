package scalar_test

// 本文件覆盖DateTime 标量的解析、序列化及无效值边界。

import (
    "bytes"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/graph/scalar"
    "testing"
    "time"
)

func TestDateTime(t *testing.T) {
    for _, input := range []string{"2025-01-02T03:04:05.987Z", "2025-01-02T11:04:05.987+08:00"} {
        var value subject.DateTime
        if err := value.UnmarshalGQL(input); err != nil {
            t.Fatal(err)
        }

        var output bytes.Buffer
        value.MarshalGQL(&output)
        if output.String() != `"2025-01-02T03:04:05Z"` {
            t.Fatalf("时间编码失配：%s", output.String())
        }
    }

    for _, input := range []any{"2025-01-02 03:04:05", 42, "invalid"} {
        var value subject.DateTime
        if value.UnmarshalGQL(input) == nil {
            t.Fatalf("无效时间输入被接受：%v", input)
        }
    }

    var output bytes.Buffer
    subject.
        DateTime(time.Date(1969, 12, 31, 23, 59, 59, 999000000, time.UTC)).MarshalGQL(&output)
    if output.String() != `"1969-12-31T23:59:59Z"` {
        t.Fatal("负纪元秒级编码失配")
    }
}
