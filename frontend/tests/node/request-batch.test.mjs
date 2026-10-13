import assert from "node:assert/strict";
import test from "node:test";
import { parse, print } from "graphql";
import { loadModule } from "./load-module.mjs";

const request = await loadModule(new URL("../../src/lib/request.ts", import.meta.url));
const query = "query Example($id: ID!) { example(id: $id) }";
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

function mockSuccess(context, sent = []) {
    context.mock.method(globalThis, "fetch", async (path, init) => {
        const body = JSON.parse(init.body);
        sent.push({ path, ...init, body });
        const result = (operation) => ({ data: { id: operation.variables.id } });
        return response(Array.isArray(body) ? body.map(result) : result(body));
    });
    return sent;
}

test("同一轮普通 query 合并并按顺序返回各自结果", async (context) => {
    const sent = mockSuccess(context);
    assert.deepEqual(
        await Promise.all([
            request.graphql(query, { id: "first" }),
            request.graphql(query, { id: "second" }),
        ]),
        [{ id: "first" }, { id: "second" }],
    );
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body, [
        { operationName: "Example", query: print(parse(query)), variables: { id: "first" } },
        { operationName: "Example", query: print(parse(query)), variables: { id: "second" } },
    ]);
    assert.equal(sent[0].path, "/api/graphql/admin");
    assert.equal(sent[0].credentials, "include");
    assert.equal(sent[0].cache, "no-store");
});

test("单条 query 保留对象请求体，变量在调用时快照", async (context) => {
    const sent = mockSuccess(context);
    const variables = { id: "before" };
    const result = request.graphql(query, variables);
    variables.id = "after";
    assert.deepEqual(await result, { id: "before" });
    assert.equal(Array.isArray(sent[0].body), false);
});

test("超过十条 query 分批发送并保持结果对应", async (context) => {
    const sent = mockSuccess(context);
    const results = await Promise.all(
        Array.from({ length: 23 }, (_, id) => request.graphql(query, { id })),
    );
    assert.deepEqual(
        results.map((result) => result.id),
        Array.from({ length: 23 }, (_, id) => id),
    );
    assert.deepEqual(
        sent.map((item) => item.body.length),
        [10, 10, 3],
    );
});

test("mutation 与身份查询独立发送，普通 query 交由 Apollo 调度", async (context) => {
    const sent = mockSuccess(context);
    const mutation = "mutation Change { change }";
    const results = await Promise.all([
        request.graphql(query, { id: "read" }),
        request.graphql(mutation, { id: "write" }),
        request.graphql(query, { id: "identity" }, undefined, true),
        request.graphql(query, { id: "later" }),
    ]);
    assert.deepEqual(
        results,
        ["read", "write", "identity", "later"].map((id) => ({ id })),
    );
    assert.equal(sent.length, 3);
    assert.deepEqual(
        sent.filter((item) => !Array.isArray(item.body)).map((item) => item.body.variables.id),
        ["write", "identity"],
    );
    assert.deepEqual(
        sent
            .find((item) => Array.isArray(item.body))
            .body.map((operation) => operation.variables.id),
        ["read", "later"],
    );
});

test("简写 query 可合并，带注释的 mutation 独立传输", async (context) => {
    const sent = mockSuccess(context);
    await Promise.all([
        request.graphql("{ example }", { id: 1 }),
        request.graphql(query, { id: 2 }),
    ]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.length, 2);
    await request.graphql("# 注释\nmutation Change { change }", { id: 3 });
    assert.equal(Array.isArray(sent[1].body), false);
});

test("发送前取消移除该操作，其余查询正常完成", async (context) => {
    const sent = mockSuccess(context);
    const controller = new AbortController();
    const canceled = request.graphql(query, { id: "cancel" }, controller.signal);
    const rejection = assert.rejects(canceled, { name: "AbortError" });
    const kept = request.graphql(query, { id: "keep" });
    controller.abort();
    await rejection;
    assert.deepEqual(await kept, { id: "keep" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.variables.id, "keep");
});

test("已取消的 signal 与全局退出均阻止排队请求发送", async (context) => {
    const sent = mockSuccess(context);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(request.graphql(query, { id: 1 }, controller.signal), {
        name: "AbortError",
    });
    const queued = request.graphql(query, { id: 2 });
    const rejection = assert.rejects(queued, { name: "AbortError" });
    request.cancelDashboardRequests();
    await rejection;
    await tick();
    assert.equal(sent.length, 0);
});

test("在途批次取消一条查询时，其余查询保持运行", async (context) => {
    let release;
    let transportSignal;
    context.mock.method(globalThis, "fetch", async (_path, init) => {
        transportSignal = init.signal;
        await new Promise((resolve) => {
            release = resolve;
        });
        return response([{ data: { id: 1 } }, { data: { id: 2 } }]);
    });
    const controller = new AbortController();
    const first = request.graphql(query, { id: 1 }, controller.signal);
    const rejection = assert.rejects(first, { name: "AbortError" });
    const second = request.graphql(query, { id: 2 });
    await tick();
    controller.abort();
    await rejection;
    assert.equal(transportSignal.aborted, false);
    release();
    assert.deepEqual(await second, { id: 2 });
});

test("整批取消中止物理请求，后续查询可继续发送", async (context) => {
    let signal;
    context.mock.method(globalThis, "fetch", async (_path, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => {
            signal.addEventListener(
                "abort",
                () => reject(new DOMException("请求已取消", "AbortError")),
                { once: true },
            );
        });
    });
    const first = assert.rejects(request.graphql(query, { id: 1 }), { name: "AbortError" });
    const second = assert.rejects(request.graphql(query, { id: 2 }), { name: "AbortError" });
    await tick();
    request.cancelDashboardRequests();
    await Promise.all([first, second]);
    assert.equal(signal.aborted, true);
    mockSuccess(context);
    assert.deepEqual(await request.graphql(query, { id: 3 }), { id: 3 });
});

test("批内业务错误和认证错误按操作处理，成功结果保持独立", async (context) => {
    const events = [];
    const errors = [];
    const unsubscribe = request.subscribeRequests((event) => events.push(event));
    const unmonitor = request.subscribeRequestErrors((error) => errors.push(error));
    context.mock.method(globalThis, "fetch", async () =>
        response([
            {
                errors: [
                    { message: "业务错误", extensions: { code: "FORBIDDEN" } },
                    { message: "认证过期", extensions: { code: "UNAUTHORIZED" } },
                ],
            },
            { data: { id: 2 } },
        ]),
    );
    try {
        const first = assert.rejects(request.graphql(query, { id: 1 }), {
            code: "UNAUTHORIZED",
            status: 200,
        });
        const second = request.graphql(query, { id: 2 });
        await first;
        assert.deepEqual(await second, { id: 2 });
        assert.deepEqual(events, ["unauthorized"]);
        assert.equal(errors.length, 1);
    } finally {
        unsubscribe();
        unmonitor();
    }
});

test("批内单条非法响应只影响对应查询", async (context) => {
    context.mock.method(globalThis, "fetch", async () => response([null, { data: { id: 2 } }]));
    const first = assert.rejects(request.graphql(query, { id: 1 }), { code: "INVALID_RESPONSE" });
    const second = request.graphql(query, { id: 2 });
    await first;
    assert.deepEqual(await second, { id: 2 });
});

test("批响应形状或长度异常整批失败并保持单次监控", async (context) => {
    for (const body of [{ data: {} }, [{ data: {} }], [{ data: {} }, { data: {} }, { data: {} }]]) {
        const errors = [];
        const unsubscribe = request.subscribeRequestErrors((error) => errors.push(error));
        context.mock.method(globalThis, "fetch", async () => response(body));
        try {
            const results = await Promise.allSettled([
                request.graphql(query, { id: 1 }),
                request.graphql(query, { id: 2 }),
            ]);
            assert.ok(
                results.every(
                    (result) =>
                        result.status === "rejected" && result.reason.code === "INVALID_RESPONSE",
                ),
            );
            assert.equal(errors.length, 2);
        } finally {
            unsubscribe();
        }
    }
});

test("网络与非 JSON HTTP 错误传递给整批，身份权限错误保持局部", async (context) => {
    for (const failure of [new Error("network"), new Response("代理故障", { status: 502 })]) {
        context.mock.method(globalThis, "fetch", async () => {
            if (failure instanceof Error) throw failure;
            return failure;
        });
        const results = await Promise.allSettled([
            request.graphql(query, { id: 1 }),
            request.graphql(query, { id: 2 }),
        ]);
        assert.ok(results.every((result) => result.status === "rejected"));
        assert.equal(results[0].reason, results[1].reason);
        if (!(failure instanceof Error)) assert.equal(results[0].reason.status, 502);
    }
    const events = [];
    const unsubscribe = request.subscribeRequests((event) => events.push(event));
    context.mock.method(globalThis, "fetch", async () => response({ message: "权限不足" }, 403));
    try {
        await assert.rejects(request.graphql(query, {}, undefined, true), { status: 403 });
        assert.deepEqual(events, []);
    } finally {
        unsubscribe();
    }
});

test("微任务内追加查询合并，后续轮次独立发送", async (context) => {
    const sent = mockSuccess(context);
    const first = request.graphql(query, { id: 1 });
    await Promise.resolve();
    const second = request.graphql(query, { id: 2 });
    await Promise.all([first, second]);
    await request.graphql(query, { id: 3 });
    assert.equal(sent.length, 2);
    assert.equal(sent[0].body.length, 2);
    assert.equal(sent[1].body.variables.id, 3);
});

test("批内非法 errors 保留对应查询的 ApiError 边界", async (context) => {
    for (const errors of [{ message: "invalid" }, [null]]) {
        context.mock.method(globalThis, "fetch", async () =>
            response([{ errors }, { data: { id: 2 } }]),
        );
        const first = assert.rejects(request.graphql(query, { id: 1 }), {
            name: "ApiError",
            code: "INVALID_RESPONSE",
        });
        const second = request.graphql(query, { id: 2 });
        await first;
        assert.deepEqual(await second, { id: 2 });
    }
});

test("批内取消发生在响应解析期间，结果对应关系保持完整", async (context) => {
    const controller = new AbortController();
    context.mock.method(globalThis, "fetch", async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        async text() {
            controller.abort();
            return JSON.stringify([{ data: { id: 1 } }, { data: { id: 2 } }]);
        },
    }));
    const first = assert.rejects(request.graphql(query, { id: 1 }, controller.signal), {
        name: "AbortError",
    });
    const second = request.graphql(query, { id: 2 });
    await first;
    assert.deepEqual(await second, { id: 2 });
});

test("共享 HTTP 认证错误通知一次，每条查询监控一次", async (context) => {
    const events = [];
    const errors = [];
    const unsubscribe = request.subscribeRequests((event) => events.push(event));
    const unmonitor = request.subscribeRequestErrors((error) => errors.push(error));
    context.mock.method(globalThis, "fetch", async () =>
        response({ code: "UNAUTHORIZED", message: "认证过期" }, 401),
    );
    try {
        const results = await Promise.allSettled([
            request.graphql(query, { id: 1 }),
            request.graphql(query, { id: 2 }),
        ]);
        assert.ok(
            results.every(
                (result) => result.status === "rejected" && result.reason.code === "UNAUTHORIZED",
            ),
        );
        assert.deepEqual(events, ["unauthorized"]);
        assert.equal(errors.length, 2);
    } finally {
        unsubscribe();
        unmonitor();
    }
});

test("mutation 保留独立次数及业务错误身份", async (context) => {
    const sent = [];
    const errors = [];
    const unsubscribe = request.subscribeRequestErrors((error) => errors.push(error));
    context.mock.method(globalThis, "fetch", async (_path, init) => {
        sent.push(JSON.parse(init.body));
        return response({
            errors: [{ message: "写入失败", extensions: { code: "INTERNAL_SERVER_ERROR" } }],
        });
    });
    try {
        const results = await Promise.allSettled([
            request.graphql("mutation Change { change }", { id: 1 }),
            request.graphql("mutation Change { change }", { id: 2 }),
        ]);
        assert.equal(sent.length, 2);
        assert.ok(sent.every((body) => !Array.isArray(body)));
        assert.ok(
            results.every(
                (result) =>
                    result.status === "rejected" && result.reason.code === "INTERNAL_SERVER_ERROR",
            ),
        );
        assert.equal(errors.length, 2);
    } finally {
        unsubscribe();
    }
});

test("合并正文按 UTF-8 字节拆批，保持单条有效请求的大小边界", async (context) => {
    const sent = mockSuccess(context);
    const payload = "汉".repeat(190000);
    assert.deepEqual(
        await Promise.all([
            request.graphql(query, { id: 1, payload }),
            request.graphql(query, { id: 2, payload }),
        ]),
        [{ id: 1 }, { id: 2 }],
    );
    assert.equal(sent.length, 2);
    assert.ok(sent.every((item) => !Array.isArray(item.body)));
    assert.ok(sent.every((item) => Buffer.byteLength(JSON.stringify(item.body)) <= 1 << 20));
});

test("认证通知触发全局取消时，当前响应保留原始 ApiError", async (context) => {
    const unsubscribe = request.subscribeRequests(() => request.cancelDashboardRequests());
    try {
        context.mock.method(globalThis, "fetch", async () =>
            response({ errors: [{ message: "认证过期", extensions: { code: "UNAUTHORIZED" } }] }),
        );
        await assert.rejects(request.graphql(query, { id: 1 }), {
            name: "ApiError",
            code: "UNAUTHORIZED",
        });
        context.mock.method(globalThis, "fetch", async () =>
            response({ code: "UNAUTHORIZED", message: "认证过期" }, 401),
        );
        const results = await Promise.allSettled([
            request.graphql(query, { id: 2 }),
            request.graphql(query, { id: 3 }),
        ]);
        assert.ok(
            results.every(
                (result) =>
                    result.status === "rejected" &&
                    result.reason.name === "ApiError" &&
                    result.reason.code === "UNAUTHORIZED",
            ),
        );
    } finally {
        unsubscribe();
    }
});

test("批次结算后的认证订阅故障进入监控并保留请求错误", async (context) => {
    const failure = new Error("认证订阅故障");
    const errors = [];
    const unsubscribe = request.subscribeRequests(() => {
        throw failure;
    });
    const unmonitor = request.subscribeRequestErrors((error) => errors.push(error));
    context.mock.method(globalThis, "fetch", async () => response({ code: "UNAUTHORIZED" }, 401));
    try {
        const results = await Promise.allSettled([
            request.graphql(query, { id: 1 }),
            request.graphql(query, { id: 2 }),
        ]);
        assert.ok(
            results.every(
                (result) => result.status === "rejected" && result.reason.code === "UNAUTHORIZED",
            ),
        );
        assert.equal(errors.filter((error) => error === failure).length, 1);
    } finally {
        unsubscribe();
        unmonitor();
    }
});

test("Apollo 解析带前置注释与片段的 query 并纳入同一批次", async (context) => {
    const sent = mockSuccess(context);
    const commented = "# 查询注释\nquery Example($id: ID!) { example(id: $id) }";
    const fragmented =
        "fragment Value on Example { id }\nquery WithFragment($id: ID!) { example(id: $id) { ...Value } }";
    assert.deepEqual(
        await Promise.all([
            request.graphql(commented, { id: 1 }),
            request.graphql(fragmented, { id: 2 }),
        ]),
        [{ id: 1 }, { id: 2 }],
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.length, 2);
});

test("Apollo no-cache 保持连续刷新请求与新结果", async (context) => {
    let calls = 0;
    context.mock.method(globalThis, "fetch", async () => response({ data: { version: ++calls } }));
    assert.deepEqual(await request.graphql("query Version { version }", {}), { version: 1 });
    assert.deepEqual(await request.graphql("query Version { version }", {}), { version: 2 });
    assert.equal(calls, 2);
});

test("Apollo 关闭相同 query 去重，保留独立操作和取消", async (context) => {
    const sent = mockSuccess(context);
    assert.deepEqual(
        await Promise.all([request.graphql(query, { id: 1 }), request.graphql(query, { id: 1 })]),
        [{ id: 1 }, { id: 1 }],
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.length, 2);
    const controller = new AbortController();
    const canceled = assert.rejects(request.graphql(query, { id: 2 }, controller.signal), {
        name: "AbortError",
    });
    const kept = request.graphql(query, { id: 2 });
    controller.abort();
    await canceled;
    assert.deepEqual(await kept, { id: 2 });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].body.variables.id, 2);
});
