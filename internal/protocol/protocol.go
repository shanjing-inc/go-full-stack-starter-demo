// Package protocol 保留现有 WebSocket、Bus 信封及查询回执，SSE 另用 Go 流协议。
package protocol

import (
    "bytes"
    "encoding/json"
    "errors"
    "io"
    "reflect"
    "regexp"
    "strings"
    "time"
    "unicode/utf16"
    "unicode/utf8"
)

// QueryTopic 定义设备查询命令的共享 Bus 主题。
const QueryTopic = "demo:bus:query:requests"

// BroadcastTopic 定义跨实例广播主题。
const BroadcastTopic = "demo:bus:broadcast"

// ResultTopic 按一次查询的响应键构造专属回执主题。
func ResultTopic(key string) string { return "demo:bus:query:results:" + key }

var uuidPattern = regexp.MustCompile(`(?i)^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)

// UUID 按协议接受标准 UUID 及兼容的全零、全一标识。
func UUID(s string) bool { return uuidPattern.MatchString(s) }

// Length 按 UTF-16 码元计长，与既有 JavaScript 客户端边界保持一致。
func Length(s string) int { return len(utf16.Encode([]rune(s))) }

// Text 校验 UTF-8 内容并按 UTF-16 码元限制长度。
func Text(s string, min, max int) bool {
    n := Length(s)
    return utf8.ValidString(s) && n >= min && n <= max
}

// Decode 严格解码单个对象到带显式 json 标签的结构体，拒绝额外字段和尾随值。
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

// jsSpace 对齐 ECMAScript String.trim 的空白集合。
func jsSpace(r rune) bool {
    switch r {
    case 0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
        return true
    }

    return r >= 0x2000 && r <= 0x200a
}

// Query 表示 HTTP 查询输入，内容在解析阶段按 JavaScript 空白规则归整。
type Query struct {
    RequestID string `json:"requestId"`
    Content   string `json:"content"`
}

// ParseQuery 校验请求 UUID 和归整后 1–2000 码元的查询内容。
func ParseQuery(raw []byte) (Query, error) {
    var q Query
    if err := Decode(raw, &q); err != nil {
        return q, err
    }

    q.Content = strings.TrimFunc(q.Content, jsSpace)
    if !UUID(q.RequestID) || !Text(q.Content, 1, 2000) {
        return q, errors.New("查询参数无效")
    }
    return q, nil
}

// Command 表示设备查询命令，响应键隔离并发查询的回执。
type Command struct {
    Type        string `json:"type"`
    RequestID   string `json:"requestId"`
    ResponseKey string `json:"responseKey"`
    Content     string `json:"content"`
}

// ParseCommand 校验固定命令类型、请求与响应 UUID 及查询内容。
func ParseCommand(raw []byte) (Command, error) {
    var q Command
    err := Decode(raw, &q)
    q.Content = strings.TrimFunc(q.Content, jsSpace)
    if err != nil || q.Type != "bus.query.execute" || !UUID(q.RequestID) || !UUID(q.ResponseKey) || !Text(q.Content, 1, 2000) {
        return q, errors.New("查询命令无效")
    }
    return q, nil
}

// Receipt 表示结果或错误回执，两种类型各自使用互斥字段集。
type Receipt struct {
    Type        string  `json:"type,omitempty"`
    RequestID   string  `json:"requestId"`
    ResponseKey string  `json:"responseKey"`
    Content     *string `json:"content,omitempty"`
    Index       *int    `json:"index,omitempty"`
    Total       *int    `json:"total,omitempty"`
    Message     *string `json:"message,omitempty"`
}

// Valid 按回执类型验证标识及字段组合，结果序号和总数范围为 1–3。
func (r Receipt) Valid() bool {
    if !UUID(r.RequestID) || !UUID(r.ResponseKey) {
        return false
    }

    switch r.Type {
    case "bus.query.result":
        return r.Content != nil && Text(*r.Content, 0, 8000) && r.Index != nil && *r.Index >= 1 && *r.Index <= 3 && r.Total != nil && *r.Total >= 1 && *r.Total <= 3 && r.Message == nil
    case "bus.query.error":
        return r.Message != nil && Text(*r.Message, 1, 2000) && r.Content == nil && r.Index == nil && r.Total == nil
    }

    return false
}

// ParseReceipt 校验最多 8 KiB 的设备回执，按类型进一步限制字段及显式 null。
func ParseReceipt(raw []byte) (Receipt, error) {
    var r Receipt
    if err := Decode(raw, &r); err != nil || !r.Valid() || len(raw) > 8192 {
        return r, errors.New("设备回执格式无效。")
    }

    var fields map[string]json.RawMessage
    _ = json.Unmarshal(raw, &fields)
    allowed := map[string]bool{"type": true, "requestId": true, "responseKey": true}
    if r.Type == "bus.query.result" {
        allowed["content"] = true
        allowed["index"] = true
        allowed["total"] = true
    } else {
        allowed["message"] = true
    }

    for key, value := range fields {
        if !allowed[key] || string(value) == "null" {
            return r, errors.New("设备回执格式无效。")
        }
    }

    return r, nil
}

// Broadcast 表示单字段广播内容。
type Broadcast struct {
    MessageBody string `json:"messageBody"`
}

// ParseBroadcast 校验广播对象和 1–2000 个 UTF-16 码元的消息内容。
func ParseBroadcast(raw []byte) (Broadcast, error) {
    var b Broadcast
    if err := Decode(raw, &b); err != nil || !Text(b.MessageBody, 1, 2000) {
        return b, errors.New("消息长度需为 1 至 2000 个字符，且只能包含 messageBody 字段。")
    }
    return b, nil
}

// ClientMessage 表示客户端 WebSocket 消息，载荷保留原始 JSON 供类型分派。
type ClientMessage struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload,omitempty"`
}

// ServerMessage 表示服务端 WebSocket 消息及毫秒级 UTC 发送时间。
type ServerMessage struct {
    Type    string `json:"type"`
    Payload any    `json:"payload"`
    SentAt  string `json:"sentAt"`
}

// Message 使用给定时钟构造统一的服务端消息信封。
func Message(kind string, payload any, now time.Time) ServerMessage {
    return ServerMessage{
        Type:    kind,
        Payload: payload,
        SentAt:  now.UTC().Format("2006-01-02T15:04:05.000Z"),
    }
}
