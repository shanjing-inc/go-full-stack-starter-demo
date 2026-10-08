package server

// 本文件覆盖既有实时协议黄金样本。

import (
    "context"
    "encoding/json"
    "github.com/coder/websocket"
    "os"
    "reflect"
    "testing"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/bus"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/protocol"
)

func TestReferenceProtocolGolden(t *testing.T) {
    raw, err := os.ReadFile("fixtures/reference-cases.json")
    if err != nil {
        t.Fatal(err)
    }

    var fixture struct {
        Cases []struct {
            Name, Kind, Input string
            Valid             bool
            Expected          json.RawMessage
        }
    }
    if err = json.Unmarshal(raw, &fixture); err != nil {
        t.Fatal(err)
    }

    for _, c := range fixture.Cases {
        t.Run(c.Name, func(t *testing.T) {
            var value any
            var err error
            switch c.Kind {
            case "query":
                value, err = protocol.ParseQuery([]byte(c.Input))
            case "command":
                value, err = protocol.ParseCommand([]byte(c.Input))
            case "receipt":
                value, err = protocol.ParseReceipt([]byte(c.Input))
            case "broadcast":
                value, err = protocol.ParseBroadcast([]byte(c.Input))
            case "envelope":
                value, err = bus.Decode([]byte(c.Input))
            case "channel":
                var input struct{ Prefix, Environment, Name, Topic string }
                _ = json.Unmarshal([]byte(c.Input), &input)
                value, err = bus.Channel(input.Prefix, input.Environment, input.Name, input.Topic)
            case "ws":
                p := newPair(t, nil)
                ws := dial(t, p.a, BroadcastSocketPath)
                var input protocol.ClientMessage
                _ = json.Unmarshal([]byte(c.Input), &input)
                if err := ws.Write(context.Background(), websocket.MessageText, []byte(c.Input)); err != nil {
                    t.Fatal(err)
                }
                message := readWS(t, ws)
                value = protocol.Message(message.Type, message.Payload, time.Date(2025, 1, 2, 3, 4, 5, 987000000, time.UTC))
                _ = ws.CloseNow()
                clean(t, p)
            default:
                t.Fatal("未知样本类型", c.Kind)
            }

            if c.Valid != (err == nil) {
                t.Fatalf("有效性: %v; 期望 %v; 错误 %v", err == nil, c.Valid, err)
            }
            if c.Valid {
                actual, _ := json.Marshal(value)
                var got, want any
                _ = json.Unmarshal(actual, &got)
                _ = json.Unmarshal(c.Expected, &want)
                if !reflect.DeepEqual(got, want) {
                    t.Fatalf("协议漂移\n当前: %s\n参考: %s", actual, c.Expected)
                }
            }
        })
    }
}
