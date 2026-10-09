package server_test

// 本文件覆盖REST 与双 GraphQL 协议、批量上下文隔离、取消恢复、来源校验和权限 Schema 契约。

import (
    "bytes"
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "log/slog"
    "net/http"
    "net/http/httptest"
    "os"
    "reflect"
    "strings"
    "sync"
    "testing"
    "time"

    graphqltransport "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/graphql"
    "github.com/vektah/gqlparser/v2"
    "github.com/vektah/gqlparser/v2/ast"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
)

func fixedTime() time.Time { return time.Date(2025, 1, 2, 3, 4, 5, 987000000, time.UTC) }

func newMemory() *service.Memory { return service.NewMemory(fixedTime) }

type faultService struct {
    service.Shops
    panicGet bool
}

func (s faultService) Get(ctx context.Context, where service.Lookup) (*service.Shop, error) {
    if s.panicGet {
        panic("secret-password internal-stack")
    }
    if where.ID != nil {
        codes := map[int]string{
            400: "BAD_USER_INPUT",
            403: "FORBIDDEN",
            410: "NOT_FOUND",
            503: "SERVICE_UNAVAILABLE",
        }
        messages := map[int]string{
            400: "输入参数无效",
            403: "操作权限不足",
            410: "目标资源不存在",
            503: "服务暂时不可用",
        }
        if code, ok := codes[*where.ID]; ok {
            return nil, &service.Error{Code: code, Message: messages[*where.ID]}
        }
        if *where.ID == 500 {
            return nil, errors.New("mysql://secret-user:secret-password@private-db/internal-trace")
        }
    }
    return s.Shops.Get(ctx, where)
}

func perform(h http.Handler, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
    r := httptest.NewRequest(method, path, strings.NewReader(body))
    for key, value := range headers {
        r.Header.Set(key, value)
    }

    if body != "" && r.Header.Get("Content-Type") == "" {
        r.Header.Set("Content-Type", "application/json")
    }

    w := httptest.NewRecorder()
    h.ServeHTTP(w, r)
    return w
}

func decoded(t *testing.T, raw []byte) any {
    t.Helper()
    var value any
    if err := json.Unmarshal(raw, &value); err != nil {
        t.Fatalf("JSON 解码失败：%v，%s", err, raw)
    }
    return value
}

// 样本来自完整参考 SDL 和现有 Yoga 处理器；仅业务 Resolver 采用替身。
func TestReferenceProtocolGolden(t *testing.T) {
    var fixture struct {
        Cases []struct {
            Name, Endpoint, Method, Mode, Search, Body string
            Headers                                    map[string]string
            Expected                                   struct {
                Status  int
                Text    string
                JSON    json.RawMessage
                Headers map[string]string
            }
        }
    }
    raw, err := os.ReadFile("../fixtures/reference-cases.json")
    if err != nil {
        t.Fatal(err)
    }
    if err = json.Unmarshal(raw, &fixture); err != nil {
        t.Fatal(err)
    }

    paths := map[string]string{
        "member": subject.MemberPath,
        "admin":  subject.AdminPath,
        "health": subject.HealthPath,
    }
    for _, item := range fixture.Cases {
        t.Run(item.Name, func(t *testing.T) {
            h := subject.New(faultService{Shops: newMemory()}, subject.Config{Introspection: true, AllowedOrigins: []string{"http://localhost:5173"}})
            got := perform(h, item.Method, paths[item.Endpoint]+item.Search, item.Body, item.Headers)
            if got.Code != item.Expected.Status {
                t.Fatalf("HTTP 状态：得到 %d，期望 %d；%s", got.Code, item.Expected.Status, got.Body.String())
            }

            for key, value := range item.Expected.Headers {
                if got.Header().Get(key) != value {
                    t.Errorf("响应头 %s：得到 %q，期望 %q", key, got.Header().Get(key), value)
                }
            }

            if item.Endpoint == "health" {
                if got.Body.String() != item.Expected.Text {
                    t.Fatalf("健康响应：%q", got.Body.String())
                }
                return
            }

            switch item.Mode {
            case "exact":
                actual, want := decoded(t, got.Body.Bytes()), decoded(t, item.Expected.JSON)
                if !reflect.DeepEqual(actual, want) {
                    t.Fatalf("协议响应差异：\n得到 %s\n期望 %s", got.Body.Bytes(), item.Expected.JSON)
                }
            case "request-error":
                actual := decoded(t, got.Body.Bytes()).(map[string]any)
                want := decoded(t, item.Expected.JSON).(map[string]any)
                actualErrors, ok := actual["errors"].([]any)
                if !ok || len(actualErrors) == 0 {
                    t.Fatalf("缺少错误信封：%s", got.Body.String())
                }
                wantExtensions, _ := want["errors"].([]any)[0].(map[string]any)["extensions"].(map[string]any)
                expectedCode := wantExtensions["code"]
                _, actualHasData := actual["data"]
                _, wantHasData := want["data"]
                if actualHasData != wantHasData {
                    t.Errorf("请求错误的 data 存在性失配：%s", got.Body.String())
                }
                for _, entry := range actualErrors {
                    e := entry.(map[string]any)
                    if e["message"] == "" {
                        t.Error("错误消息为空")
                    }

                    ext, _ := e["extensions"].(map[string]any)
                    if ext["code"] != expectedCode {
                        t.Errorf("错误码：得到 %v，期望 %v", ext["code"], expectedCode)
                    }
                    if _, ok := ext["originalError"]; ok {
                        t.Error("输入错误包含原始异常")
                    }
                }
            case "preflight":
                if got.Body.Len() != 0 {
                    t.Error("预检响应需要空正文")
                }
            default:
                t.Fatalf("未知对照模式：%s", item.Mode)
            }

            for _, secret := range []string{
                "secret-password",
                "private-db",
                "internal-trace",
                "internal-stack",
            } {
                if strings.Contains(got.Body.String(), secret) {
                    t.Errorf("响应泄露内部标识：%s", secret)
                }
            }
        })
    }
}

func TestSharedServiceGraphQLAndREST(t *testing.T) {
    memory := newMemory()
    h := subject.New(memory, subject.Config{Introspection: true})
    created := perform(h, "POST", subject.AdminPath, `{"query":"mutation {createShop(set:{name:\"共享店铺\",slug:\"shared\"}){id name}}"}`, nil)
    if created.Code != 200 || strings.Contains(created.Body.String(), "errors") {
        t.Fatal(created.Body.String())
    }

    member := perform(h, "POST", subject.MemberPath, `{"query":"{getShop(where:{id:{eq:2}}){id name}}"}`, nil)
    rest := perform(h, "GET", "/api/rest/poc/shops/2", "", nil)
    for _, result := range []*httptest.ResponseRecorder{member, rest} {
        if result.Code != 200 || !strings.Contains(result.Body.String(), "共享店铺") {
            t.Fatalf("共享服务失效：%d %s", result.Code, result.Body.String())
        }
    }

    id := 2
    row, err := memory.Get(context.Background(), service.Lookup{ID: &id})
    if err != nil || row == nil || row.Name != "共享店铺" {
        t.Fatal("独立 context 调用共享服务失效")
    }
}

type contextService struct {
    service.Shops
    mu   sync.Mutex
    seen []service.RequestMeta
}

func (s *contextService) Get(ctx context.Context, where service.Lookup) (*service.Shop, error) {
    meta, ok := service.RequestFrom(ctx)
    if !ok {
        return nil, errors.New("请求上下文缺失")
    }
    s.mu.Lock()
    s.seen = append(s.seen, meta)
    s.mu.Unlock()
    return s.Shops.Get(ctx, where)
}

func TestBatchRequestContext(t *testing.T) {
    shops := &contextService{Shops: newMemory()}
    h := subject.New(shops, subject.Config{Introspection: true})
    operation := `{"query":"{getShop(where:{id:{eq:1}}){id}}"}`
    response := perform(h, "POST", subject.MemberPath, "["+operation+","+operation+"]", map[string]string{"X-POC-Probe": "batch", "Cookie": "poc-probe=sample"})
    if response.Code != 200 || len(shops.seen) != 2 {
        t.Fatalf("上下文采样失败：%s，%v", response.Body.String(), shops.seen)
    }
    if shops.seen[0] != shops.seen[1] || shops.seen[0].ProbeHeader != "batch" || shops.seen[0].ProbeCookie != "sample" || shops.seen[0].Endpoint != subject.MemberPath {
        t.Fatalf("批处理上下文失配：%v", shops.seen)
    }
}

func TestConcurrentRequestContextIsolation(t *testing.T) {
    shops := &contextService{Shops: newMemory()}
    h := subject.New(shops, subject.Config{Introspection: true})
    var wg sync.WaitGroup
    failures := make(chan string, 32)
    for i := range 32 {
        wg.Add(1)
        go func() {
            defer wg.Done()
            result := perform(h, "POST", subject.MemberPath, `{"query":"{getShop(where:{id:{eq:1}}){id}}"}`, map[string]string{"X-POC-Probe": fmt.Sprint(i)})
            if result.Code != 200 || strings.Contains(result.Body.String(), "errors") {
                failures <- result.Body.String()
            }
        }()
    }

    wg.Wait()
    close(failures)
    for failure := range failures {
        t.Error(failure)
    }

    ids, probes := map[string]bool{}, map[string]bool{}
    for _, meta := range shops.seen {
        if ids[meta.RequestID] || probes[meta.ProbeHeader] {
            t.Fatal("并发请求上下文串用")
        }

        ids[meta.RequestID] = true
        probes[meta.ProbeHeader] = true
    }

    if len(ids) != 32 {
        t.Fatalf("请求数：%d", len(ids))
    }
}

func TestCancellationAndRecovery(t *testing.T) {
    t.Run("canceled", func(t *testing.T) {
        memory := newMemory()
        h := subject.New(memory, subject.Config{Introspection: true})
        ctx, cancel := context.WithCancel(context.Background())
        cancel()
        r := httptest.NewRequest("POST", subject.AdminPath, strings.NewReader(`{"query":"mutation {createShop(set:{name:\"取消样例\",slug:\"canceled\"}){id}}"}`)).WithContext(ctx)
        r.Header.Set("Content-Type", "application/json")
        w := httptest.NewRecorder()
        h.ServeHTTP(w, r)
        id := 2
        row, _ := memory.Get(context.Background(), service.Lookup{ID: &id})
        if row != nil {
            t.Fatal("取消请求产生了业务写入")
        }
    })
    t.Run("panic", func(t *testing.T) {
        h := subject.New(faultService{Shops: newMemory(), panicGet: true}, subject.Config{Introspection: true})
        got := perform(h, "POST", subject.MemberPath, `{"query":"{getShop(where:{id:{eq:1}}){id}}"}`, nil)
        if got.Code != 200 || !strings.Contains(got.Body.String(), "INTERNAL_SERVER_ERROR") || strings.Contains(got.Body.String(), "secret-password") {
            t.Fatalf("panic 边界失效：%s", got.Body.String())
        }

        health := perform(h, "GET", subject.HealthPath, "", nil)
        if health.Code != 200 {
            t.Fatal("panic 后服务不可用")
        }
    })
}

func TestInputBoundary(t *testing.T) {
    for _, item := range []struct {
        name, body string
        status     int
    }{
        {"null", "null", 400}, {"numeric_query", `{"query":123}`, 400},
        {"invalid_json", "{secret-password", 400},
        {
            "over_limit",
            strings.Repeat("x", int(graphqltransport.MaxBodyBytes)+1),
            413,
        },
        {
            "invalid_batch_member",
            `[{"query":"mutation {createShop(set:{name:\"x\",slug:\"x\"}){id}}"},null]`,
            400,
        },
    } {
        t.Run(item.name, func(t *testing.T) {
            memory := newMemory()
            got := perform(subject.New(memory, subject.Config{Introspection: true}), "POST", subject.AdminPath, item.body, nil)
            if got.Code != item.status || strings.Contains(got.Body.String(), "secret-password") {
                t.Fatalf("输入边界失效：%d %s", got.Code, got.Body.String())
            }

            id := 2
            row, _ := memory.Get(context.Background(), service.Lookup{ID: &id})
            if row != nil {
                t.Error("无效批处理产生了提前写入")
            }
        })
    }
}

func TestOriginsAndRESTErrors(t *testing.T) {
    h := subject.New(faultService{Shops: newMemory()}, subject.Config{Introspection: true, AllowedOrigins: []string{"http://localhost:5173"}})
    for _, item := range []struct {
        path   string
        status int
        code   string
    }{
        {"/api/rest/poc/shops/bad", 400, "BAD_USER_INPUT"},
        {"/api/rest/poc/shops/99", 404, "NOT_FOUND"},
        {"/api/rest/poc/shops/403", 403, "FORBIDDEN"},
        {"/api/rest/poc/shops/500", 500, "INTERNAL_SERVER_ERROR"},
        {"/unknown", 404, "HTTP_ERROR"},
    } {
        got := perform(h, "GET", item.path, "", nil)
        if got.Code != item.status || !strings.Contains(got.Body.String(), item.code) || strings.Contains(got.Body.String(), "secret-password") {
            t.Errorf("REST 边界失效：%s => %d %s", item.path, got.Code, got.Body.String())
        }
    }

    denied := perform(h, "POST", subject.MemberPath, `{"query":"{getShop(where:{id:{eq:1}}){id}}"}`, map[string]string{"Origin": "https://evil.example"})
    if denied.Code != 403 || denied.Header().Get("Access-Control-Allow-Origin") != "" {
        t.Fatal("未授权来源被接受")
    }
}

func TestComplexityLimit(t *testing.T) {
    var query strings.Builder
    query.WriteString("{")
    for i := range 110 {
        fmt.Fprintf(&query, "s%d:getShop(where:{id:{eq:1}}){id} ", i)
    }

    query.WriteString("}")
    body, _ := json.Marshal(map[string]any{"query": query.String()})
    got := perform(subject.New(newMemory(), subject.Config{Introspection: true}), "POST", subject.MemberPath, string(body), nil)
    if !strings.Contains(got.Body.String(), "COMPLEXITY_LIMIT_EXCEEDED") {
        t.Fatalf("复杂度限制失效：%d %s", got.Code, got.Body.String())
    }
}

// 权限查询扩展限定于 admin，并固定字段存在性、返回类型和参数契约。
func validatePermissionsQuery(endpoint string, query *ast.Definition) error {
    if query == nil {
        return errors.New("目标 Schema 缺少 Query，契约比对需要实际应用 SDL")
    }

    field := query.Fields.ForName("getCurrentPermissions")
    switch endpoint {
    case "admin":
        if field == nil {
            return errors.New("admin Query 缺少 getCurrentPermissions")
        }
        if field.Type.String() != "[String!]!" || len(field.Arguments) != 0 {
            return fmt.Errorf("admin 权限查询契约失配：类型 %s，参数 %d；期望 [String!]!、零参数", field.Type.String(), len(field.Arguments))
        }
    case "member":
        if field != nil {
            return errors.New("member Query 出现 admin 专属字段 getCurrentPermissions")
        }
    default:
        return fmt.Errorf("权限查询契约端点未知：%s", endpoint)
    }

    return nil
}

func TestPermissionsQueryContract(t *testing.T) {
    for _, item := range []struct {
        name, endpoint, query, wantError string
    }{
        {"admin_valid", "admin", "getCurrentPermissions: [String!]!", ""},
        {
            "admin_field_removed",
            "admin",
            "health: Boolean",
            "缺少 getCurrentPermissions",
        },
        {
            "admin_nullable_list",
            "admin",
            "getCurrentPermissions: [String!]",
            "契约失配",
        },
        {
            "admin_nullable_element",
            "admin",
            "getCurrentPermissions: [String]!",
            "契约失配",
        },
        {
            "admin_scalar_type",
            "admin",
            "getCurrentPermissions: String!",
            "契约失配",
        },
        {
            "admin_argument_added",
            "admin",
            "getCurrentPermissions(scope: String): [String!]!",
            "契约失配",
        },
        {"member_valid", "member", "health: Boolean", ""},
        {
            "member_field_added",
            "member",
            "getCurrentPermissions: [String!]!",
            "admin 专属字段",
        },
    } {
        t.Run(item.name, func(t *testing.T) {
            schema, err := gqlparser.LoadSchema(&ast.Source{Input: "type Query { " + item.query + " }"})
            if err != nil {
                t.Fatal(err)
            }

            err = validatePermissionsQuery(item.endpoint, schema.Query)
            if item.wantError == "" {
                if err != nil {
                    t.Fatal(err)
                }
            } else if err == nil || !strings.Contains(err.Error(), item.wantError) {
                t.Fatalf("权限查询变异应命中 %q，实际：%v", item.wantError, err)
            }
        })
    }
}

// 每个保留字段的类型、参数和可空性对照完整参考 SDL。
func TestSchemaProjection(t *testing.T) {
    for _, endpoint := range []string{"member", "admin"} {
        t.Run(endpoint, func(t *testing.T) {
            read := func(path string) string {
                t.Helper()
                raw, err := os.ReadFile(path)
                if err != nil {
                    t.Fatalf("读取 Schema 样本 %s：%v", path, err)
                }
                return string(raw)
            }
            original := read("../fixtures/reference-" + endpoint + ".graphql")
            common := read("../../schema/common.graphqls")
            local := read("../../schema/" + endpoint + ".graphqls")
            source, err := gqlparser.LoadSchema(&ast.Source{Input: original})
            if err != nil {
                t.Fatal(err)
            }

            target, err := gqlparser.LoadSchema(&ast.Source{Input: common + local})
            if err != nil {
                t.Fatal(err)
            }
            if err := validatePermissionsQuery(endpoint, target.Query); err != nil {
                t.Fatal(err)
            }

            for _, name := range []string{
                "ShopItem",
                "ShopFilters",
                "IntFilters",
                "StringFilters",
                "Query",
                "CreateShopSetInput",
                "Mutation",
                "ShopOrderBy",
                "InnerOrder",
                "OrderDirection",
                "UserItem",
                "UserFilters",
                "UserOrderBy",
                "CreateUserSetInput",
                "UpdateUserSetInput",
            } {
                current := target.Types[name]
                if current == nil {
                    continue
                }

                baseline := source.Types[name]
                if baseline == nil {
                    t.Fatalf("参考类型缺失：%s", name)
                }

                for _, field := range current.Fields {
                    // admin 权限查询扩展已通过存在性、类型和参数契约检查。
                    if endpoint == "admin" && name == "Query" && field.Name == "getCurrentPermissions" {
                        continue
                    }
                    // 会话管理是明确登记的 Go 后台扩展，参考用户 CRUD 契约继续逐字段核对。
                    if name == "Mutation" && (field.Name == "revokeUserSessions" || field.Name == "revokeUserSession") || name == "Query" && field.Name == "listUserSessions" {
                        continue
                    }

                    want := baseline.Fields.ForName(field.Name)
                    if want == nil || field.Type.String() != want.Type.String() {
                        t.Errorf("字段类型失配：%s.%s", name, field.Name)
                        continue
                    }
                    if len(field.Arguments) != len(want.Arguments) {
                        t.Errorf("参数数量失配：%s.%s", name, field.Name)
                    }

                    for _, argument := range field.Arguments {
                        expected := want.Arguments.ForName(argument.Name)
                        if expected == nil || expected.Type.String() != argument.Type.String() {
                            t.Errorf("参数类型失配：%s.%s(%s)", name, field.Name, argument.Name)
                        }
                    }
                }
            }
        })
    }
}

func TestRequestLogRedaction(t *testing.T) {
    // ErrorPresenter 保留稳定日志标识；原始连接串保持在响应和默认日志之外。
    var output bytes.Buffer
    logger := slog.New(slog.NewTextHandler(&output, nil))
    h := subject.New(faultService{Shops: newMemory()}, subject.Config{Introspection: true, Logger: logger})
    got := perform(h, "POST", subject.MemberPath, `{"query":"{getShop(where:{id:{eq:500}}){id}}"}`, nil)
    for _, value := range []string{
        "request_id=",
        "endpoint=" + subject.MemberPath,
        "GraphQL 操作异常",
    } {
        if !strings.Contains(output.String(), value) {
            t.Errorf("日志缺少稳定标识 %q：%s", value, output.String())
        }
    }

    for _, secret := range []string{"secret-password", "secret-user", "private-db", "internal-trace"} {
        if strings.Contains(output.String(), secret) || strings.Contains(got.Body.String(), secret) {
            t.Errorf("默认日志或响应泄露了故障样本内容 %q", secret)
        }
    }
}

func TestHTTPInputAndOriginPolicy(t *testing.T) {
    h := subject.New(newMemory(), subject.Config{Introspection: true, AllowedOrigins: []string{"http://localhost:5173"}})
    for _, item := range []struct {
        name, method, path, body string
        headers                  map[string]string
        status                   int
    }{
        {
            "unsupported_content_type",
            "POST",
            subject.MemberPath,
            "query { __typename }",
            map[string]string{"Content-Type": "text/plain"},
            415,
        },
        {
            "preflight_denied_header",
            "OPTIONS",
            subject.MemberPath,
            "",
            map[string]string{
                "Origin":                         "http://localhost:5173",
                "Access-Control-Request-Method":  "POST",
                "Access-Control-Request-Headers": "x-untrusted",
            },
            400,
        },
        {
            "preflight_denied_method",
            "OPTIONS",
            subject.MemberPath,
            "",
            map[string]string{"Origin": "http://localhost:5173", "Access-Control-Request-Method": "DELETE"},
            400,
        },
        {
            "preflight_missing_origin",
            "OPTIONS",
            subject.MemberPath,
            "",
            map[string]string{"Access-Control-Request-Method": "POST"},
            400,
        },
        {"health_method", "POST", subject.HealthPath, "", nil, 405},
    } {
        t.Run(item.name, func(t *testing.T) {
            got := perform(h, item.method, item.path, item.body, item.headers)
            if got.Code != item.status {
                t.Errorf("HTTP 输入边界失配：%d %s", got.Code, got.Body.String())
            }
        })
    }

    allowed := perform(h, "POST", subject.MemberPath, `{"query":"{__typename}"}`, map[string]string{"Origin": "http://localhost:5173"})
    if allowed.Code != 200 || allowed.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" || !strings.Contains(allowed.Header().Get("Vary"), "Origin") {
        t.Fatalf("允许来源的 HTTP 响应失配：%d %v", allowed.Code, allowed.Header())
    }
}

func TestFilterPOCBoundary(t *testing.T) {
    for _, query := range []string{
        `{getShop(where:{id:{inArray:[1]}}){id}}`,
        `{getShop(where:{slug:{like:"de%"}}){id}}`,
    } {
        body, _ := json.Marshal(map[string]string{"query": query})
        got := perform(subject.New(newMemory(), subject.Config{Introspection: true}), "POST", subject.MemberPath, string(body), nil)
        if got.Code != 200 || !strings.Contains(got.Body.String(), "BAD_USER_INPUT") || !strings.Contains(got.Body.String(), "当前查询支持 eq 条件") {
            t.Errorf("未实现的过滤操作符需要明确范围提示：%s", got.Body.String())
        }
    }
}
