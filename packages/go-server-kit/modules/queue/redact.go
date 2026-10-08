package queue

import (
    "encoding/json"
    "regexp"
    "sort"
    "strconv"
    "strings"
)

const hidden = "[已脱敏]"

var assignments = regexp.MustCompile(`(?i)(password|passwd|pwd|token|secret|authorization|cookie|api[_-]?key|access[_-]?key|private[_-]?key)(["']?\s*[:=]\s*["']?)([^\s,;"'}]+)`)

var quotedAssignments = regexp.MustCompile(`(?i)(password|passwd|pwd|token|secret|authorization|cookie|api[_-]?key|access[_-]?key|private[_-]?key)(["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*')`)

var cookieHeader = regexp.MustCompile(`(?im)\b(set-cookie|cookie|authorization)\s*:\s*[^\r\n]+`)

var bearer = regexp.MustCompile(`(?i)\b(Bearer|Basic)\s+[A-Za-z0-9+/._=-]+`)

var jwt = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`)

var urlCredentials = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.-]*://)[^/@\s]+:[^/@\s]+@`)

var pem = regexp.MustCompile(`(?s)-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----`)

// sensitive 归一化字段名后匹配凭据相关关键词，供结构化数据脱敏使用。
func sensitive(key string) bool {
    k := strings.ToLower(strings.NewReplacer("_", "", "-", "", ".", "", " ", "").Replace(key))
    for _, name := range []string{
        "password",
        "passwd",
        "token",
        "secret",
        "authorization",
        "cookie",
        "apikey",
        "accesskey",
        "privatekey",
        "credential",
        "sessionid",
        "encryptionkey",
        "signingkey",
        "dsn",
        "connectionstring",
        "密码",
        "令牌",
        "密钥",
    } {
        if strings.Contains(k, name) {
            return true
        }
    }

    return k == "pwd"
}

// collect 遍历结构化内容及嵌入 JSON 文本，收集敏感字段中的字符串值。
func collect(v any, values *[]string) {
    switch v := v.(type) {
    case map[string]any:
        for k, item := range v {
            if sensitive(k) {
                gather(item, values)
            } else {
                collect(item, values)
            }
        }
    case []any:
        for _, item := range v {
            collect(item, values)
        }
    case string:
        var structured any
        if json.Unmarshal([]byte(v), &structured) == nil {
            if _, isString := structured.(string); !isString {
                collect(structured, values)
            }
        }
    }
}

// gather 收集敏感字段内至少三字节的字符串，用于跨字段文本替换。
func gather(v any, values *[]string) {
    switch v := v.(type) {
    case string:
        if len(v) >= 3 {
            *values = append(*values, v)
        }
    case map[string]any:
        for _, item := range v {
            gather(item, values)
        }
    case []any:
        for _, item := range v {
            gather(item, values)
        }
    }
}

// text 替换已收集敏感值及常见认证头、连接凭据、JWT 和私钥片段。
func text(v string, values []string) string {
    for _, secret := range values {
        v = strings.ReplaceAll(v, secret, hidden)
    }

    v = quotedAssignments.ReplaceAllString(v, "${1}${2}"+hidden)
    v = cookieHeader.ReplaceAllString(v, "${1}: "+hidden)
    v = urlCredentials.ReplaceAllString(v, "${1}"+hidden+"@")
    v = pem.ReplaceAllString(v, hidden)
    v = bearer.ReplaceAllString(v, hidden)
    v = jwt.ReplaceAllString(v, hidden)
    return assignments.ReplaceAllString(v, "${1}${2}"+hidden)
}

// redact 递归生成脱敏副本，结构化字符串保持 JSON 文本返回形态。
func redact(v any, values []string) any {
    switch v := v.(type) {
    case map[string]any:
        out := map[string]any{}
        for k, item := range v {
            if sensitive(k) {
                out[k] = hidden
            } else {
                out[k] = redact(item, values)
            }
        }
        return out
    case []any:
        out := make([]any, len(v))
        for i, item := range v {
            out[i] = redact(item, values)
        }
        return out
    case string:
        var structured any
        if json.Unmarshal([]byte(v), &structured) == nil {
            if _, isString := structured.(string); !isString {
                body, _ := json.Marshal(redact(structured, values))
                return string(body)
            }
        }
        return text(v, values)
    default:
        return v
    }
}

// project 对历史返回值生成安全副本，先收集敏感值再按长度降序替换跨字段泄露内容。
func (s *Service) project(r *Record) *Record {
    copy := *r
    values := []string{}
    collect(r.Data, &values)
    collect(r.ReturnValue, &values)
    collect(r.Opts, &values)
    collect(r.Meta, &values)
    sort.Slice(values, func(i, j int) bool { return len(values[i]) > len(values[j]) })
    copy.Data = redact(r.Data, values)
    copy.ReturnValue = redact(r.ReturnValue, values)
    copy.Opts = redact(r.Opts, values)
    copy.Meta = redact(r.Meta, values)
    copy.FailedReason = redact(r.FailedReason, values).(string)
    copy.Stacktrace = make([]string, len(r.Stacktrace))
    for i, line := range r.Stacktrace {
        copy.Stacktrace[i] = redact(line, values).(string)
    }

    return &copy
}

func strconvNumber(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
