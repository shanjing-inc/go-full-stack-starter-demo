const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, elements, texts } = require("./harness.cjs");
function fixture(t, options) {
    const h = createHarness(options);
    t.after(() => h.stop());
    return h;
}
const input = (h, placeholder, value) =>
    elements(h.render())
        .find((item) => item.type === "Input" && item.props.placeholder === placeholder)
        .props.onInput({ detail: { value } });
const button = (h, label) =>
    elements(h.render()).find(
        (item) =>
            item.type === "Button" &&
            (Array.isArray(item.props.children)
                ? item.props.children.join("")
                : item.props.children) === label,
    );
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

test("邮箱密码登录使用同源接口，仅保存有效 token，密码保持原样", async (t) => {
    const h = fixture(t);
    const auth = h.source("auth/session.ts");
    await auth.signIn(" user@example.test ", " password ");
    assert.equal(auth.getAuthToken(), "test-session");
    assert.equal(h.state.requests[0].url, "https://test.invalid/api/graphql/member");
    assert.equal(h.state.requests[0].method, "POST");
    assert.equal(h.state.requests[0].timeout, 15000);
    assert.equal(
        JSON.stringify(JSON.parse(h.state.requests[0].data).variables.input),
        '{"email":"user@example.test","password":" password "}',
    );
    assert.equal(h.state.requests[0].header["Content-Type"], "application/json");
    assert.equal(h.state.requests[0].header.Authorization, undefined);
    assert.deepEqual([...h.state.storage.values()], ["test-session"]);
});

test("登录校验、缺少端点、无效 token 与网络错误保持本地会话", async (t) => {
    const h = fixture(t, { token: "existing-session" });
    const auth = h.source("auth/session.ts");
    for (const [email, password] of [
        ["", "x"],
        [" ", "x"],
        ["a@b.test", ""],
    ])
        await assert.rejects(auth.signIn(email, password));
    assert.equal(h.state.requests.length, 0);
    for (const data of [{}, { token: {} }, { token: " " }, { token: "bad token" }]) {
        h.state.authResponses["signInWithEmail"] = {
            statusCode: 200,
            data: { data: { signInWithEmail: data } },
        };
        await assert.rejects(auth.signIn("a@b.test", "password"));
        assert.equal(auth.getAuthToken(), "existing-session");
    }
    h.state.authResponses["signInWithEmail"] = {
        statusCode: 200,
        data: {
            errors: [{ message: "邮箱或密码错误", extensions: { code: "INVALID_CREDENTIALS" } }],
        },
    };
    await assert.rejects(auth.signIn("a@b.test", "password"), /邮箱或密码错误/);
    h.state.mode = "timeout";
    await assert.rejects(auth.signIn("a@b.test", "password"), /超时/);
    assert.equal(auth.getAuthToken(), "existing-session");
    const empty = fixture(t, { endpoint: "" });
    await assert.rejects(
        empty.source("auth/session.ts").signIn("a@b.test", "password"),
        /TARO_APP_GRAPHQL_ENDPOINT/,
    );
    assert.equal(empty.state.requests.length, 0);
});

test("认证空响应保留会话并提示重试", async (t) => {
    const h = fixture(t, { token: "existing-session" });
    const auth = h.source("auth/session.ts");
    for (const data of [null, undefined, {}, { data: null }]) {
        h.state.authResponses.signInWithEmail = { statusCode: 200, data };
        await assert.rejects(auth.signIn("user@example.test", "password"), /登录失败/);
        h.state.authResponses.signOut = { statusCode: 200, data };
        await assert.rejects(auth.signOut(), /退出登录失败/);
        assert.equal(auth.getAuthToken(), "existing-session");
    }
});

test("登录沿用后端邮箱边界，存储写入失败保持原会话并提示重试", async (t) => {
    const h = fixture(t, { token: "existing-session" });
    const auth = h.source("auth/session.ts");
    h.state.storageWriteError = true;
    await assert.rejects(auth.signIn("owner@localhost", "password"), /保存登录会话失败/);
    assert.equal(JSON.parse(h.state.requests[0].data).variables.input.email, "owner@localhost");
    assert.equal(auth.getAuthToken(), "existing-session");
    h.state.storageWriteError = false;
    await auth.signIn("owner@localhost", "password");
    assert.equal(auth.getAuthToken(), "test-session");
});

test("退出撤销同源会话，失败保留 token，成功及 401 清理 token", async (t) => {
    const h = fixture(t, { token: "existing-session" });
    const auth = h.source("auth/session.ts");
    h.state.authResponses["signOut"] = {
        statusCode: 503,
        data: { errors: [{ message: "服务暂不可用" }] },
    };
    await assert.rejects(auth.signOut(), /服务暂不可用/);
    assert.equal(auth.getAuthToken(), "existing-session");
    assert.equal(h.state.requests[0].header.Authorization, "Bearer existing-session");
    h.state.authResponses["signOut"] = { statusCode: 200, data: { data: { signOut: false } } };
    await assert.rejects(auth.signOut(), /退出登录失败/);
    assert.equal(auth.getAuthToken(), "existing-session");
    h.state.authResponses["signOut"] = { statusCode: 200, data: { data: { signOut: true } } };
    await auth.signOut();
    assert.equal(auth.getAuthToken(), "");
    const expired = fixture(t, { token: "expired-session" });
    expired.state.authResponses["signOut"] = { statusCode: 401, data: {} };
    await expired.source("auth/session.ts").signOut();
    assert.equal(expired.source("auth/session.ts").getAuthToken(), "");
});

test("真实 Apollo 五条查询携带 token，401 清理会话并提示重登，403 保留会话", async (t) => {
    const h = fixture(t, { token: "existing-session" });
    const api = h.source("graphql/member/shop.ts");
    assert.equal((await api.diagnoseBatch({ id: { eq: 1 } })).length, 5);
    assert.equal(h.state.requests.length, 1);
    assert.equal(h.state.requests[0].header.authorization, "Bearer existing-session");
    h.state.status = 403;
    await api.diagnoseBatch({ id: { eq: 1 } });
    assert.equal(h.source("auth/session.ts").getAuthToken(), "existing-session");
    h.state.status = 401;
    const rows = await api.diagnoseBatch({ id: { eq: 1 } });
    assert.ok(rows.every((row) => /登录已失效.*重新登录/u.test(row.error)));
    assert.equal(h.source("auth/session.ts").getAuthToken(), "");
});

test("HTTP 200 的 GraphQL 失效会话支持批量清理与重新登录提示", async (t) => {
    const h = fixture(t, { token: "expired-session" });
    h.state.mode = "unauthorized";
    const rows = await h.source("graphql/member/shop.ts").diagnoseBatch({ id: { eq: 1 } });
    assert.ok(rows.every((row) => /登录已失效.*重新登录/u.test(row.error)));
    assert.equal(h.source("auth/session.ts").getAuthToken(), "");
    const logout = fixture(t, { token: "expired-session" });
    logout.state.authResponses.signOut = {
        statusCode: 200,
        data: { errors: [{ extensions: { code: "UNAUTHORIZED" } }] },
    };
    await logout.source("auth/session.ts").signOut();
    assert.equal(logout.source("auth/session.ts").getAuthToken(), "");
});

test("token 按服务端点隔离，异源请求保持无会话，旧 401 保留新 token", async (t) => {
    const h = fixture(t, { token: "old-session" });
    const auth = h.source("auth/session.ts");
    const fetch = h.source("graphql/taro-fetch.ts").taroFetch;
    await fetch("https://other.invalid/api/graphql/member", { body: "[]" });
    assert.equal(h.state.requests[0].header.authorization, undefined);
    h.state.status = 401;
    h.state.delay = 25;
    const pending = fetch("https://test.invalid/api/graphql/member", { body: "[]" });
    h.state.storage.set(auth.AUTH_TOKEN_STORAGE_KEY, "new-session");
    await assert.rejects(pending, /重新登录/);
    assert.equal(auth.getAuthToken(), "new-session");
    const other = fixture(t, { endpoint: "https://other.invalid/api/graphql/member" });
    other.state.storage = h.state.storage;
    assert.equal(other.source("auth/session.ts").getAuthToken(), "");
    h.state.storage.set(auth.AUTH_TOKEN_STORAGE_KEY, { token: "wrong-type" });
    assert.equal(auth.getAuthToken(), "");
    h.state.storageReadError = true;
    assert.equal(auth.getAuthToken(), "");
});

test("页面登录与查询互斥、防重复、清空密码，退出后恢复登录表单", async (t) => {
    const h = fixture(t);
    input(h, "店铺 ID 或 slug", "1");
    button(h, "发送单次请求").props.onClick();
    await settle();
    assert.match(texts(h.render()), /请先登录/);
    assert.equal(h.state.requests.length, 0);
    input(h, "邮箱", "a@b.test");
    input(h, "密码", "password");
    const click = button(h, "登录").props.onClick;
    click();
    click();
    button(h, "发送单次请求").props.onClick();
    assert.ok(
        elements(h.render())
            .filter((item) => item.type === "Button")
            .every((item) => item.props.disabled),
    );
    await settle();
    assert.equal(h.state.requests.length, 1);
    assert.match(texts(h.render()), /已登录/);
    assert.ok(button(h, "退出登录"));
    button(h, "发送 5 条并发请求").props.onClick();
    button(h, "退出登录").props.onClick();
    await settle();
    assert.equal(h.state.requests.length, 2);
    assert.equal(h.state.requests[1].header.authorization, "Bearer test-session");
    assert.match(texts(h.render()), /全部成功/);
    button(h, "退出登录").props.onClick();
    await settle();
    assert.match(texts(h.render()), /已退出登录/);
    assert.equal(button(h, "登录").props.disabled, false);
    assert.equal(
        elements(h.render()).find(
            (item) => item.type === "Input" && item.props.placeholder === "密码",
        ).props.value,
        "",
    );
    assert.doesNotMatch(texts(h.render()), /测试店铺/);
});

test("页面失败可重试、过期恢复登录表单、卸载后保持原 UI", async (t) => {
    const h = fixture(t);
    input(h, "邮箱", "a@b.test");
    input(h, "密码", "password");
    h.state.authResponses["signInWithEmail"] = {
        statusCode: 200,
        data: {
            errors: [{ message: "邮箱或密码错误", extensions: { code: "INVALID_CREDENTIALS" } }],
        },
    };
    button(h, "登录").props.onClick();
    await settle();
    assert.match(texts(h.render()), /邮箱或密码错误/);
    assert.equal(button(h, "登录").props.disabled, false);
    h.state.authResponses["signInWithEmail"] = {
        statusCode: 200,
        data: { data: { signInWithEmail: { token: "test-session" } } },
    };
    button(h, "登录").props.onClick();
    await settle();
    input(h, "店铺 ID 或 slug", "1");
    h.state.status = 401;
    button(h, "发送 5 条并发请求").props.onClick();
    await settle();
    assert.ok(button(h, "登录"));
    assert.match(texts(h.render()), /重新登录/);
    const unloaded = fixture(t);
    input(unloaded, "邮箱", "a@b.test");
    input(unloaded, "密码", "password");
    button(unloaded, "登录").props.onClick();
    unloaded.unload();
    await settle();
    assert.doesNotMatch(texts(unloaded.render()), /登录成功/);
});
