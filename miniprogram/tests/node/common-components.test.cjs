const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, elements, texts } = require("./harness.cjs");

test("开关受控变化回传，禁用和加载期间不更改业务状态", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Switch } = h.source("components/ui/switch.tsx");
    const changes = [];
    for (const options of [{}, { disabled: true }, { loading: true }]) {
        const tree = h.renderComponent(Switch, {
            ...options,
            value: false,
            onChange: (event) => changes.push(event.detail.value),
        });
        tree.props.onChange({ detail: { value: true } });
        assert.deepEqual(changes, [true]);
        assert.equal(tree.props.value, false);
    }
});

test("选择组回传数组和单值，支持取消，禁用或只读时阻止变化", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    for (const [file, name, value, next] of [
        ["checkbox-group", "CheckboxGroup", ["goods"], ["goods", "orders"]],
        ["radio-group", "RadioGroup", "standard", null],
    ]) {
        const Component = h.source(`components/ui/${file}.tsx`)[name];
        const changes = [];
        for (const options of [{}, { disabled: true }, { readonly: true }]) {
            const tree = h.renderComponent(Component, {
                ...options,
                value,
                options: [{ label: "选项", value: "goods" }],
                onChange: (event) => changes.push(event.detail.value),
            });
            tree.props.onChange({ detail: { value: next } });
            assert.deepEqual(changes, [next]);
            assert.equal(tree.props.value, value);
        }
    }
});

test("多行输入使用项目光标色，输入及确认回传，禁用或只读不提交变化", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    h.source("components/theme/project.ts").projectTheme.colors.light.primary = "#166534";
    const { Textarea } = h.source("components/ui/textarea.tsx");
    const changes = [];
    let confirmed;
    for (const options of [{}, { disabled: true }, { readonly: true }]) {
        const tree = h.renderComponent(Textarea, {
            ...options,
            value: "",
            maxlength: 120,
            indicator: true,
            onChange: (event) => changes.push(event.detail.value),
            onEnter: (event) => {
                confirmed = event.detail.value;
            },
        });
        assert.equal(tree.props.cursorColor, "#166534");
        assert.equal(tree.props.maxlength, 120);
        tree.props.onChange({ detail: { value: "第一行\n第二行", cursor: 7 } });
        assert.deepEqual(changes, ["第一行\n第二行"]);
        tree.props.onEnter({ detail: { value: "已确认" } });
        assert.equal(confirmed, "已确认");
    }
});

test("表单分类示例保留选择与多行输入回填，不访问后端", (t) => {
    const h = createHarness({ endpoint: "", token: "" });
    t.after(() => h.stop());
    const page = "pages/dev/components/form/index.tsx";
    const node = (type, predicate = () => true) =>
        elements(h.render(page)).find((e) => e.type === type && predicate(e));
    node("t-switch", (e) => !e.props.disabled && !e.props.loading).props.onChange({
        detail: { value: true },
    });
    assert.equal(node("t-switch", (e) => !e.props.disabled && !e.props.loading).props.value, true);
    node("t-checkbox-group").props.onChange({ detail: { value: ["goods", "orders"] } });
    assert.deepEqual(node("t-checkbox-group").props.value, ["goods", "orders"]);
    node("t-radio-group").props.onChange({ detail: { value: "express" } });
    assert.equal(node("t-radio-group").props.value, "express");
    node("t-textarea", (e) => !e.props.disabled).props.onChange({
        detail: { value: "请提前联系" },
    });
    assert.equal(node("t-textarea", (e) => !e.props.disabled).props.value, "请提前联系");
    assert.equal(h.state.requests.length, 0);
});

test("内容分类示例显示列表点击反馈，无需表单页状态", (t) => {
    const h = createHarness({ endpoint: "", token: "" });
    t.after(() => h.stop());
    const page = "pages/dev/components/content/index.tsx";
    const cell = elements(h.render(page)).find(
        (e) => e.type === "t-cell" && e.props.title === "消息设置",
    );
    cell.props.onClick({ detail: {} });
    assert.match(texts(h.render(page)), /已点击：消息设置/u);
    assert.equal(h.state.requests.length, 0);
});
