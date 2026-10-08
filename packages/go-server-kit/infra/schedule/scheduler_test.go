package schedule_test

// 本文件覆盖调度定义、时区与表达式校验。

import (
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/schedule"
    "testing"
    "time"
)

func TestDefinition(t *testing.T) {
    d := subject.Definition{Name: "tick", Expression: "@every 2s", Timezone: "Asia/Shanghai"}
    s, e := d.Parse()
    if e != nil {
        t.Fatal(e)
    }
    if !subject.Due(s, time.Unix(10, 0)) || subject.Due(s, time.Unix(11, 0)) {
        t.Fatal("UTC 相位变化")
    }

    d.Timezone = "unknown"
    if _, e = d.Parse(); e == nil {
        t.Fatal("无效时区需要错误")
    }
}
