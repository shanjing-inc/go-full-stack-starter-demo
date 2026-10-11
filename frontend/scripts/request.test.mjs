import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { buildSchema, parse, validate } from "graphql";

async function load(relative) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const request = await load("../src/request.ts");
const operations = await load("../src/graphql/admin/operations.ts");

function response(body, status = 200) {
    return new Response(JSON.stringify(body), { status });
}

test("14 条运行时操作各自携带所需片段并通过 Admin SDL 校验", async () => {
    const sources = await Promise.all(
        ["common", "admin", "queue"].map((name) =>
            readFile(new URL(`../../schema/${name}.graphqls`, import.meta.url), "utf8"),
        ),
    );
    const schema = buildSchema(sources.join("\n"));
    assert.equal(Object.keys(operations).length, 14);
    const generated = await readFile(
        new URL("../src/graphql/admin/generated.ts", import.meta.url),
        "utf8",
    );
    for (const [name, document] of Object.entries(operations)) {
        const parsed = parse(document);
        assert.deepEqual(validate(schema, parsed), [], name);
        const operation = parsed.definitions.find(
            (definition) => definition.kind === "OperationDefinition",
        );
        const type =
            operation.name.value[0].toUpperCase() +
            operation.name.value.slice(1) +
            operation.operation[0].toUpperCase() +
            operation.operation.slice(1);
        assert.ok(generated.includes(`export type ${type} =`), `${name} 生成结果类型`);
        assert.ok(generated.includes(`export type ${type}Variables =`), `${name} 生成变量类型`);
    }
});

test("GraphQL 保留同源 Cookie、变量、结果和缓存设置", async (context) => {
    let sent;
    context.mock.method(globalThis, "fetch", async (path, init) => {
        sent = { path, ...init };
        return response({ data: { listShops: [] } });
    });
    const variables = { where: { slug: { like: "%demo%" } }, limit: 21, offset: 0 };
    assert.deepEqual(await request.graphql(operations.LIST_ADMIN_SHOPS, variables), {
        listShops: [],
    });
    assert.equal(sent.path, "/api/graphql/admin");
    assert.equal(sent.credentials, "include");
    assert.equal(sent.cache, "no-store");
    assert.deepEqual(JSON.parse(sent.body), { query: operations.LIST_ADMIN_SHOPS, variables });
});

test("认证错误优先通知，身份请求的权限错误保持局部", async (context) => {
    const events = [];
    const unsubscribe = request.subscribeRequests((event) => events.push(event));
    try {
        context.mock.method(globalThis, "fetch", async () =>
            response({
                errors: [
                    { message: "业务错误", extensions: { code: "FORBIDDEN" } },
                    { message: "认证过期", extensions: { code: "UNAUTHORIZED" } },
                ],
            }),
        );
        await assert.rejects(request.graphql(operations.GET_DASHBOARD_SESSION, {}), {
            code: "UNAUTHORIZED",
        });
        assert.deepEqual(events, ["unauthorized"]);
        context.mock.method(globalThis, "fetch", async () =>
            response({ message: "权限不足" }, 403),
        );
        await assert.rejects(
            request.graphql(operations.GET_DASHBOARD_SESSION, {}, undefined, true),
            { status: 403 },
        );
        assert.deepEqual(events, ["unauthorized"]);
    } finally {
        unsubscribe();
    }
});

test("缺失 GraphQL 数据和非 JSON 错误保留错误边界", async (context) => {
    context.mock.method(globalThis, "fetch", async () => response({}));
    await assert.rejects(request.graphql(operations.LIST_ADMIN_SHOPS, {}), {
        code: "INVALID_RESPONSE",
    });
    context.mock.method(globalThis, "fetch", async () => new Response("代理故障", { status: 502 }));
    await assert.rejects(request.graphql(operations.LIST_ADMIN_SHOPS, {}), {
        code: "HTTP_ERROR",
        status: 502,
    });
});

test("解析期间取消和全局退出取消均阻止结果返回", async (context) => {
    for (const cancelAll of [false, true]) {
        const controller = new AbortController();
        context.mock.method(globalThis, "fetch", async (_path, init) => ({
            ok: true,
            status: 200,
            async text() {
                if (cancelAll) request.cancelDashboardRequests();
                else controller.abort();
                assert.equal(init.signal.aborted, true);
                return JSON.stringify({ data: { listShops: [] } });
            },
        }));
        await assert.rejects(request.graphql(operations.LIST_ADMIN_SHOPS, {}, controller.signal), {
            name: "AbortError",
        });
    }
});
