const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, elements, texts } = require("./harness.cjs");

test("原生按钮保留开放能力，禁用或加载时拦截业务点击", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Button } = h.source("components/ui/button.tsx");
    let clicked = 0;
    for (const options of [{}, { disabled: true }, { loading: true }]) {
        const tree = h.renderComponent(Button, {
            ...options,
            openType: "share",
            children: "分享",
            onClick: () => clicked++,
        });
        assert.equal(tree.type, "t-button");
        assert.equal(tree.props.openType, "share");
        assert.equal(tree.props.children, "分享");
        tree.props.onTap({});
        assert.equal(clicked, 1);
        assert.equal(tree.props.disabled, !!(options.disabled || options.loading));
    }
});

test("输入框保留输入和键盘属性，焦点和错误状态可观察", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Input } = h.source("components/ui/input.tsx");
    let value;
    let focused = 0;
    const props = {
        id: "password",
        password: true,
        confirmType: "done",
        invalid: true,
        onFocus: () => focused++,
        onInput: (e) => {
            value = e.detail.value;
        },
    };
    let tree = h.renderComponent(Input, props);
    assert.equal(tree.type, "View", "外壳保留局部间距与点击聚焦");
    let input = elements(tree).find((item) => item.type === "t-input");
    assert.equal(input.props.id, "password");
    assert.equal(input.props.type, "password");
    assert.equal(input.props.confirmType, "done");
    input.props.onChange({ detail: { value: "原始输入" } });
    assert.equal(value, "原始输入");
    input.props.onFocus({});
    tree = h.renderComponent(Input, props);
    assert.equal(elements(tree).find((e) => e.type === "t-input").props.focus, false);
    assert.equal(elements(tree).find((e) => e.type === "t-input").props.status, "error");
    assert.equal(focused, 1);
    input = elements(tree).find((item) => item.type === "t-input");
    input.props.onBlur({});
    tree = h.renderComponent(Input, { ...props, disabled: true, value: "当前不可编辑" });

    assert.equal(elements(tree).find((e) => e.type === "t-input").props.disabled, true);
    input = elements(tree).find((item) => item.type === "t-input");
    assert.equal(input.props.disabled, true);
    assert.equal(input.props.value, "当前不可编辑");
});

test("卡片、标签和空态保留内容", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    for (const [file, name, props] of [
        ["card", "Card", { title: "卡片标题", children: "卡片内容" }],
        ["tag", "Tag", { variant: "success", children: "已完成" }],
        ["empty-state", "EmptyState", { title: "暂无记录", description: "查询后显示结果" }],
    ]) {
        const tree = h.renderComponent(h.source(`components/ui/${file}.tsx`)[name], props);
        assert.ok(elements(tree).length > 0);
        assert.match(texts(tree), new RegExp(props.title ?? props.children, "u"));
    }
});

test("点击输入框外壳可反复请求原生聚焦，禁用时不聚焦", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Input } = h.source("components/ui/input.tsx");
    const native = (tree) => elements(tree).find((item) => item.type === "t-input");
    let tree = h.renderComponent(Input, {});
    assert.equal(!!native(tree).props.focus, false);
    tree.props.onClick({});
    tree = h.renderComponent(Input, {});
    assert.equal(native(tree).props.focus, true);
    native(tree).props.onFocus({});
    native(tree).props.onBlur({});
    tree = h.renderComponent(Input, {});
    assert.equal(native(tree).props.focus, false);
    tree.props.onClick({});
    assert.equal(native(h.renderComponent(Input, {})).props.focus, true);
    h.renderComponent(Input, { disabled: true });
    tree = h.renderComponent(Input, { disabled: true });
    tree.props.onClick({});
    assert.equal(native(h.renderComponent(Input, { disabled: true })).props.focus, false);
    tree = h.renderComponent(Input, {});
    tree.props.onClick({});
    assert.equal(native(h.renderComponent(Input, {})).props.focus, true);
});

test("外部 focus 的变化仍可请求聚焦和失焦", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Input } = h.source("components/ui/input.tsx");
    const render = (props) => {
        h.renderComponent(Input, props);
        return elements(h.renderComponent(Input, props)).find((item) => item.type === "t-input");
    };
    assert.equal(render({ focus: true }).props.focus, true);
    assert.equal(render({ focus: false }).props.focus, false);
    assert.equal(render({ focus: true, disabled: true }).props.focus, false);
    assert.equal(render({ focus: true }).props.focus, true);
});
