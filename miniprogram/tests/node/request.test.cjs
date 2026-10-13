const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./harness.cjs");
function fixture(t, options) {
    const harness = createHarness(options);
    t.after(() => harness.stop());
    return harness;
}

test("生成操作通过真实 Apollo 合并，重复查询保持独立且保序", async (t) => {
    const h = fixture(t);
    const { getShop } = h.source("graphql/member/shop.ts");
    const result = await Promise.all([1, 2, 3].map((id) => getShop({ id: { eq: id } })));
    assert.deepEqual(
        result.map((shop) => shop.id),
        ["1", "2", "3"],
    );
    assert.equal(h.state.requests.length, 1);
    const body = JSON.parse(h.state.requests[0].data);
    assert.equal(body.length, 3);
    assert.equal(body[0].operationName, "GetMemberShop");
    await getShop({ id: { eq: 1 } });
    assert.equal(h.state.requests.length, 2);
});

test("批量上限为 10，五个相同查询参与测试", async (t) => {
    const h = fixture(t);
    const { getShop, diagnoseBatch } = h.source("graphql/member/shop.ts");
    await Promise.all(Array.from({ length: 11 }, () => getShop({ id: { eq: 1 } })));
    assert.deepEqual(
        h.state.requests.map((request) => JSON.parse(request.data).length),
        [10, 1],
    );
    h.state.delay = 25;
    const rows = await diagnoseBatch({ id: { eq: 1 } });
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.shop?.id === "1" && row.durationMs >= 25));
    assert.equal(JSON.parse(h.state.requests[2].data).length, 5);
});

for (const mode of ["graphql", "missing", "invalid-count", "invalid-json", "network", "timeout"]) {
    test(`诊断完整呈现 ${mode} 错误`, async (t) => {
        const h = fixture(t);
        h.state.mode = mode;
        const rows = await h.source("graphql/member/shop.ts").diagnoseBatch({ id: { eq: 1 } });
        assert.equal(rows.length, 5);
        assert.ok(rows.every((row) => typeof row.error === "string" && row.error.length > 0));
    });
}
test("批内单项错误隔离，空店铺作为有效响应", async (t) => {
    const h = fixture(t);
    h.state.mode = "partial";
    const api = h.source("graphql/member/shop.ts");
    const rows = await api.diagnoseBatch({ id: { eq: 1 } });
    assert.equal(rows.filter((row) => row.error).length, 1);
    h.state.mode = "empty";
    assert.equal(await api.getShop({ id: { eq: 1 } }), null);
});
test("HTTP 错误传播，端点为空时给出配置指引", async (t) => {
    const h = fixture(t);
    h.state.status = 401;
    await assert.rejects(h.source("graphql/member/shop.ts").getShop({ id: { eq: 1 } }));
    const empty = fixture(t, { endpoint: "" });
    await assert.rejects(
        empty.source("graphql/member/shop.ts").getShop({ id: { eq: 1 } }),
        /TARO_APP_GRAPHQL_ENDPOINT/,
    );
    assert.equal(empty.state.requests.length, 0);
});
test("ID 与 slug 输入校验，端点限定 Member 且拒绝凭据", (t) => {
    const h = fixture(t);
    const { lookupWhere } = h.source("graphql/member/shop.ts");
    assert.equal(JSON.stringify(lookupWhere(" 12 ")), '{"id":{"eq":12}}');
    assert.equal(JSON.stringify(lookupWhere(" demo-shop ")), '{"slug":{"eq":"demo-shop"}}');
    for (const value of ["", "0", "2147483648", "-1", "+1"])
        assert.throws(() => lookupWhere(value));
    const { normalizeEndpoint } = h.source("config/endpoint.ts");
    for (const value of [
        "/api/graphql/member",
        "https://host/api/graphql/admin",
        "https://user:pass@host/api/graphql/member",
        "https://host/api/graphql/member?token=secret",
    ])
        assert.throws(() => normalizeEndpoint(value));
});
test("Taro fetch 支持对象、数组与 Headers，预取消和在途取消清理请求", async (t) => {
    const h = fixture(t);
    const { taroFetch, normalizeHeaders } = h.source("graphql/taro-fetch.ts");
    assert.equal(normalizeHeaders(new Headers({ "X-Test": "one" }))["x-test"], "one");
    assert.equal(normalizeHeaders([["X-Test", "two"]])["x-test"], "two");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(taroFetch("https://test.invalid", { signal: controller.signal }), {
        name: "AbortError",
    });
    assert.equal(h.state.requests.length, 0);
    const active = new AbortController();
    const request = taroFetch("https://test.invalid", { body: "[]", signal: active.signal });
    active.abort();
    await assert.rejects(request, { name: "AbortError" });
    assert.equal(h.state.aborted, 1);
});
