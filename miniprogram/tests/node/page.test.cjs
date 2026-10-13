const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createHarness, elements, texts } = require("./harness.cjs");
const element = (tree, type) =>
    elements(tree).find(
        (item) => item.type === type && item.props.placeholder === "店铺 ID 或 slug",
    );
const buttons = (tree) =>
    elements(tree).filter(
        (item) => item.type === "Button" && /^发送/u.test(String(item.props.children)),
    );
function fixture(t, options) {
    const h = createHarness({ token: "test-session", ...options });
    t.after(() => h.stop());
    return h;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

test("唯一启动页面为 batch-test，页面源码仅保留该目录", (t) => {
    const h = fixture(t);
    const config = h.source("app.config.ts").default;
    assert.equal(JSON.stringify(config.pages), '["pages/dev/batch-test/index"]');
    const pages = path.resolve(__dirname, "../../src/pages");
    assert.deepEqual(fs.readdirSync(pages), ["dev"]);
    assert.deepEqual(fs.readdirSync(path.join(pages, "dev")), ["batch-test"]);
    assert.equal(
        elements(h.render()).some((item) => item.type === "Navigator"),
        false,
    );
});
test("单次请求展示结果与总耗时，拦截重复点击，错误后允许重试", async (t) => {
    const h = fixture(t);
    element(h.render(), "Input").props.onInput({ detail: { value: "1" } });
    const action = buttons(h.render())[0].props.onClick;
    action();
    action();
    assert.ok(buttons(h.render()).every((button) => button.props.disabled));
    await settle();
    assert.match(texts(h.render()), /测试店铺/);
    assert.match(texts(h.render()), /单个操作 总耗时 \d+ms，全部成功/);
    assert.equal(h.state.requests.length, 1);
    assert.equal(JSON.parse(h.state.requests[0].data).length, 1);
    h.state.mode = "network";
    buttons(h.render())[0].props.onClick();
    await settle();
    assert.match(texts(h.render()), /网络请求失败/);
    assert.match(texts(h.render()), /失败 1 个/);
    assert.ok(buttons(h.render()).every((button) => !button.props.disabled));
    h.state.mode = "empty";
    buttons(h.render())[0].props.onClick();
    await settle();
    assert.match(texts(h.render()), /暂无匹配/);
});
test("五条并发操作合并传输，逐项保序显示成功与错误", async (t) => {
    const h = fixture(t);
    h.state.mode = "partial";
    element(h.render(), "Input").props.onInput({ detail: { value: "demo-shop" } });
    const action = buttons(h.render())[1].props.onClick;
    action();
    action();
    await settle();
    assert.equal(h.state.requests.length, 1);
    const operations = JSON.parse(h.state.requests[0].data);
    assert.equal(operations.length, 5);
    assert.ok(operations.every((operation) => operation.variables.where.slug.eq === "demo-shop"));
    const output = texts(h.render());
    assert.match(output, /5 个并发操作 总耗时 \d+ms，失败 1 个/);
    assert.equal((output.match(/测试店铺/gu) ?? []).length, 4);
    assert.equal((output.match(/查询失败/gu) ?? []).length, 1);
    assert.ok(output.indexOf("请求 1") < output.indexOf("请求 2"));
    assert.ok(output.indexOf("请求 2") < output.indexOf("请求 5"));
});
test("空输入保持本地校验，页面卸载后忽略延迟结果", async (t) => {
    const h = fixture(t);
    buttons(h.render())[1].props.onClick();
    await settle();
    assert.match(texts(h.render()), /请输入/);
    assert.equal(h.state.requests.length, 0);
    element(h.render(), "Input").props.onInput({ detail: { value: "1" } });
    buttons(h.render())[1].props.onClick();
    h.unload();
    await settle();
    assert.doesNotMatch(texts(h.render()), /测试店铺/);
    assert.doesNotMatch(texts(h.render()), /全部成功/);
});
test("缺少端点配置时展示配置指引与每项失败，保持重试可用", async (t) => {
    const h = fixture(t, { endpoint: "" });
    element(h.render(), "Input").props.onInput({ detail: { value: "1" } });
    buttons(h.render())[1].props.onClick();
    await settle();
    assert.equal(h.state.requests.length, 0);
    assert.equal((texts(h.render()).match(/TARO_APP_GRAPHQL_ENDPOINT/gu) ?? []).length, 5);
    assert.match(texts(h.render()), /失败 5 个/);
    assert.ok(buttons(h.render()).every((button) => !button.props.disabled));
});
