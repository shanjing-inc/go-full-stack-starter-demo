package graphql

import (
    "bytes"
    "encoding/json"
    "io"
    "mime"
    "net/http"
    "strings"

    gql "github.com/99designs/gqlgen/graphql"
)

// MaxBodyBytes 限制 GraphQL POST 正文为 1 MiB。
const MaxBodyBytes int64 = 1 << 20

const maxBatch = 10

// responseBuffer 只用于单结果 JSON 请求；实时传输按单独生命周期实现。
type responseBuffer struct {
    headers http.Header
    status  int
    body    bytes.Buffer
}

func newBuffer() *responseBuffer { return &responseBuffer{headers: make(http.Header)} }

// Header 返回当前操作独立维护的响应头。
func (b *responseBuffer) Header() http.Header { return b.headers }

// WriteHeader 记录当前操作的 HTTP 状态，供批量响应汇总。
func (b *responseBuffer) WriteHeader(status int) {
    if b.status == 0 {
        b.status = status
    }
}

// Write 向当前操作缓冲区追加响应体。
func (b *responseBuffer) Write(p []byte) (int, error) {
    if b.status == 0 {
        b.status = 200
    }
    return b.body.Write(p)
}

// compatibleTransport 补齐 Yoga 的请求批处理及旧客户端 HTTP 状态约定。
func CompatibleTransport(next http.Handler, config Config) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        origin := r.Header.Get("Origin")
        if origin != "" {
            w.Header().Add("Vary", "Origin")
            if !config.originAllowed(origin) {
                writeRequestError(w, http.StatusForbidden, "请求来源未授权")
                return
            }
            w.Header().Set("Access-Control-Allow-Origin", origin)
        }
        if r.Method == http.MethodOptions {
            method := r.Header.Get("Access-Control-Request-Method")
            if origin == "" || (method != "POST" && method != "GET") {
                writeRequestError(w, 400, "预检需要有效来源与请求方法")
                return
            }

            headers := r.Header.Get("Access-Control-Request-Headers")
            for _, header := range strings.Split(headers, ",") {
                switch strings.TrimSpace(strings.ToLower(header)) {
                case "", "content-type", "authorization", "x-request-id":
                default:
                    writeRequestError(w, 400, "预检包含未授权请求头")
                    return
                }
            }

            w.Header().Set("Access-Control-Allow-Methods", method)
            if headers != "" {
                w.Header().Set("Access-Control-Allow-Headers", headers)
            }
            w.WriteHeader(http.StatusNoContent)
            return
        }
        if r.Method != http.MethodGet && r.Method != http.MethodPost {
            w.Header().Set("Allow", "GET, POST")
            writeRequestError(w, 405, "GraphQL only supports GET and POST requests.")
            return
        }
        if r.Method == http.MethodGet {
            sendSingle(w, r, next)
            return
        }

        media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
        if err != nil || media != "application/json" {
            writeRequestError(w, 415, "GraphQL 接收 application/json 请求")
            return
        }

        body, err := io.ReadAll(io.LimitReader(r.Body, MaxBodyBytes+1))
        if err != nil {
            writeRequestError(w, 400, "读取请求正文失败")
            return
        }
        if int64(len(body)) > MaxBodyBytes {
            writeRequestError(w, 413, "请求正文超过大小限制")
            return
        }

        trimmed := bytes.TrimSpace(body)
        if !json.Valid(trimmed) {
            writeRequestError(w, 400, "POST body sent invalid JSON.")
            return
        }
        if len(trimmed) > 0 && trimmed[0] == '[' {
            var operations []json.RawMessage
            if json.Unmarshal(trimmed, &operations) != nil {
                writeRequestError(w, 400, "批处理格式无效")
                return
            }
            if len(operations) > maxBatch {
                writeRequestError(w, 413, "Batching is limited to 10 operations per request.")
                return
            }
            // 先校验全部成员，避免前序 mutation 执行后才发现无效 JSON 形状。
            for _, operation := range operations {
                if !validOperation(operation) {
                    writeRequestError(w, 400, "批处理操作需要有效对象")
                    return
                }
            }

            results := make([]json.RawMessage, 0, len(operations))
            for _, operation := range operations {
                if r.Context().Err() != nil {
                    writeRequestError(w, 408, "请求已取消")
                    return
                }

                child := r.Clone(r.Context())
                child.Body = io.NopCloser(bytes.NewReader(operation))
                child.ContentLength = int64(len(operation))
                output := newBuffer()
                sendSingle(output, child, next)
                results = append(results, json.RawMessage(output.body.Bytes()))
            }

            w.Header().Set("Content-Type", batchResponseType(r)+"; charset=utf-8")
            w.WriteHeader(200)
            _ = json.NewEncoder(w).Encode(results)
            return
        }
        if !validOperation(trimmed) {
            writeRequestError(w, 400, "GraphQL 操作需要有效对象")
            return
        }

        r.Body = io.NopCloser(bytes.NewReader(trimmed))
        r.ContentLength = int64(len(trimmed))
        sendSingle(w, r, next)
    })
}

// validOperation 校验批处理成员为可解码的操作对象，供整批预检使用。
func validOperation(raw []byte) bool {
    trimmed := bytes.TrimSpace(raw)
    if len(trimmed) == 0 || trimmed[0] != '{' {
        return false
    }

    var operation gql.RawParams
    return json.Unmarshal(trimmed, &operation) == nil
}

// sendSingle 缓冲单操作响应并适配既有 HTTP 状态、变量错误及返回媒体类型。
func sendSingle(w http.ResponseWriter, r *http.Request, next http.Handler) {
    output := newBuffer()
    next.ServeHTTP(output, r)
    status := output.status
    if status == 0 {
        status = 200
    }

    var envelope map[string]json.RawMessage
    if json.Unmarshal(output.body.Bytes(), &envelope) == nil {
        var gqlErrors []map[string]any
        _ = json.Unmarshal(envelope["errors"], &gqlErrors)
        getMutation := r.Method == http.MethodGet && status == http.StatusNotAcceptable && len(gqlErrors) == 1 && gqlErrors[0]["message"] == "GET requests only allow query operations"
        if getMutation {
            w.Header().Set("Allow", "POST")
            writeRequestError(w, 405, "Can only perform a mutation operation from a POST request.")
            return
        }

        requestError := status == http.StatusUnprocessableEntity
        operationResolution := false
        variableError := false
        for _, entry := range gqlErrors {
            extensions, _ := entry["extensions"].(map[string]any)
            code, _ := extensions["code"].(string)
            if code == "GRAPHQL_PARSE_FAILED" || code == "GRAPHQL_VALIDATION_FAILED" {
                requestError = true
            }
            if path, ok := entry["path"].([]any); ok && len(path) > 0 && path[0] == "variable" && code == "" {
                variableError = true
                requestError = true
            }
            if code == "OPERATION_RESOLUTION_FAILURE" {
                operationResolution = true
            }
        }

        if requestError {
            delete(envelope, "data")
            // Yoga 的旧 application/json 客户端保留 HTTP 200 错误信封。
            if variableError || !strings.HasPrefix(output.headers.Get("Content-Type"), "application/graphql-response+json") {
                status = 200
            }
            output.body.Reset()
            _ = json.NewEncoder(&output.body).Encode(envelope)
        }
        if operationResolution {
            status = http.StatusBadRequest
        }
    }

    for key, values := range output.headers {
        w.Header()[key] = append([]string(nil), values...)
    }

    if contentType := w.Header().Get("Content-Type"); contentType != "" && !strings.Contains(contentType, "charset=") {
        w.Header().Set("Content-Type", contentType+"; charset=utf-8")
    }
    w.WriteHeader(status)
    _, _ = w.Write(output.body.Bytes())
}

// batchResponseType 与固定 gqlgen transport 的首个支持媒体类型选择保持一致。
// 空 batch 同样需要声明响应类型；更多 Accept 优先级语义留到完整兼容评审。
func batchResponseType(r *http.Request) string {
    accept := r.Header.Get("Accept")
    if accept == "" {
        return "application/json"
    }

    for _, part := range strings.Split(accept, ",") {
        media, _, err := mime.ParseMediaType(strings.TrimSpace(part))
        if err != nil {
            continue
        }

        switch media {
        case "*/*", "application/*", "application/json":
            return "application/json"
        case "application/graphql-response+json":
            return media
        }
    }

    return "application/graphql-response+json"
}

func writeRequestError(w http.ResponseWriter, status int, message string) {
    w.Header().Set("Content-Type", "application/json; charset=utf-8")
    w.WriteHeader(status)
    _ = json.NewEncoder(w).Encode(map[string]any{"errors": []any{map[string]any{"message": message, "extensions": map[string]any{"code": "BAD_REQUEST"}}}})
}
