import { test, expect } from "@playwright/test";
// 使用 Vite 提供真实 Apollo 请求模块，页面与 API 通过隔离 route 提供。
test.beforeEach(async ({ page }) => {
    await page.route("**/graphql-batch-probe", (route) =>
        route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><title>GraphQL 合并验收</title>",
        }),
    );
    await page.goto("/graphql-batch-probe");
});

test("浏览器合并两条查询并保持变量与结果对应", async ({ page }) => {
    const bodies: unknown[] = [];
    await page.route("**/api/graphql/admin", async (route) => {
        const body = route.request().postDataJSON();
        bodies.push(body);
        await route.fulfill({
            json: body.map((operation: { variables: { id: number } }) => ({
                data: { id: operation.variables.id },
            })),
        });
    });
    const result = await page.evaluate(async () => {
        const path = "/admin/src/lib/request.ts";
        const { graphql } = await import(path);
        return Promise.all([
            graphql("query First { first }", { id: 1 }),
            graphql("query Second { second }", { id: 2 }),
        ]);
    });
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(bodies).toEqual([
        [
            { operationName: "First", query: "query First {\n  first\n}", variables: { id: 1 } },
            { operationName: "Second", query: "query Second {\n  second\n}", variables: { id: 2 } },
        ],
    ]);
});

test("浏览器在途取消一条查询，其余查询成功返回", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const bodies: unknown[] = [];
    await page.route("**/api/graphql/admin", async (route) => {
        const body = route.request().postDataJSON();
        bodies.push(body);
        await gate;
        await route.fulfill({ json: [{ data: { id: 1 } }, { data: { id: 2 } }] });
    });
    const started = page.waitForRequest("**/api/graphql/admin");
    const result = page.evaluate(async () => {
        const path = "/admin/src/lib/request.ts";
        const { graphql } = await import(path);
        const controller = new AbortController();
        Object.assign(window, { cancelBatchProbe: () => controller.abort() });
        return Promise.allSettled([
            graphql("query First { first }", { id: 1 }, controller.signal),
            graphql("query Second { second }", { id: 2 }),
        ]).then((results) =>
            results.map((result) =>
                result.status === "fulfilled"
                    ? { status: result.status, value: result.value }
                    : { status: result.status, name: result.reason.name },
            ),
        );
    });
    await started;
    await page.evaluate(() =>
        (window as unknown as { cancelBatchProbe: () => void }).cancelBatchProbe(),
    );
    release();
    expect(await result).toEqual([
        { status: "rejected", name: "AbortError" },
        { status: "fulfilled", value: { id: 2 } },
    ]);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toHaveLength(2);
});

test("浏览器携带同源 Cookie，mutation 与身份查询独立传输", async ({ page, context }) => {
    await context.addCookies([
        { name: "apollo-probe", value: "session", url: new URL(page.url()).origin },
    ]);
    const sent: { body: unknown; cookie: string | undefined }[] = [];
    await page.route("**/api/graphql/admin", async (route) => {
        const body = route.request().postDataJSON();
        sent.push({ body, cookie: route.request().headers().cookie });
        const result = (operation: { variables: { id: string } }) => ({
            data: { id: operation.variables.id },
        });
        await route.fulfill({ json: Array.isArray(body) ? body.map(result) : result(body) });
    });
    const results = await page.evaluate(async () => {
        const path = "/admin/src/lib/request.ts";
        const { graphql } = await import(path);
        return Promise.all([
            graphql("query Read { read }", { id: "read" }),
            graphql("mutation Write { write }", { id: "write" }),
            graphql("query Identity { identity }", { id: "identity" }, undefined, true),
            graphql("query Later { later }", { id: "later" }),
        ]);
    });
    expect(results).toEqual(["read", "write", "identity", "later"].map((id) => ({ id })));
    expect(sent).toHaveLength(3);
    expect(sent.every((item) => item.cookie?.includes("apollo-probe=session"))).toBe(true);
    expect(sent.filter((item) => Array.isArray(item.body))).toHaveLength(1);
    expect(sent.find((item) => Array.isArray(item.body))?.body).toHaveLength(2);
    expect(sent.filter((item) => !Array.isArray(item.body)).map((item) => item.body)).toEqual([
        expect.objectContaining({ operationName: "Write", variables: { id: "write" } }),
        expect.objectContaining({ operationName: "Identity", variables: { id: "identity" } }),
    ]);
});
