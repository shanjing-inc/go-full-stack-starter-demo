const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, elements } = require("./harness.cjs");

test("按钮的官方外观可独立覆盖，保留业务默认值、平台属性与点击保护", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Button } = h.source("components/ui/button.tsx");
    const original = h.renderComponent(Button, {});
    assert.equal(original.props.theme, "primary");
    assert.equal(original.props.variant, "base");
    assert.equal(original.props.size, "medium");
    for (const size of ["extra-small", "small", "medium", "large"]) {
        let clicks = 0;
        const node = h.renderComponent(Button, {
            variant: "secondary",
            theme: "danger",
            appearance: "dashed",
            size,
            shape: "round",
            ghost: true,
            icon: "add",
            block: true,
            loadingProps: { theme: "dots" },
            openType: "share",
            loading: true,
            onClick: () => clicks++,
        });
        assert.equal(node.props.theme, "danger");
        assert.equal(node.props.variant, "dashed");
        assert.equal(node.props.size, size);
        assert.equal(node.props.shape, "round");
        assert.equal(node.props.block, true);
        assert.equal(node.props.icon, "add");
        assert.equal(node.props.loadingProps.theme, "dots");
        assert.equal(node.props.openType, "share");
        assert.equal(node.props.appearance, undefined);
        node.props.onTap({});
        assert.equal(clicks, 0);
    }
    assert.equal(h.renderComponent(Button, { block: true, fullWidth: false }).props.block, false);
});

test("状态标签支持官方外观和关闭事件，语义默认值继续有效", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Tag } = h.source("components/ui/tag.tsx");
    assert.equal(h.renderComponent(Tag, { variant: "success" }).props.variant, "light");
    let close;
    const node = h.renderComponent(Tag, {
        variant: "success",
        theme: "warning",
        appearance: "outline",
        shape: "round",
        size: "large",
        closable: true,
        onClose: (event) => {
            close = event.detail;
        },
    });
    assert.equal(node.props.theme, "warning");
    assert.equal(node.props.variant, "outline");
    assert.equal(node.props.shape, "round");
    assert.equal(node.props.appearance, undefined);
    node.props.onClose({ detail: { detail: { x: 12, y: 24 } } });
    assert.deepEqual(close, { x: 12, y: 24 });
});

test("输入框允许官方状态和布局，invalid 优先，清除回调可回填受控值", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Input } = h.source("components/ui/input.tsx");
    let value = "搜索词";
    const render = (extra = {}) =>
        elements(
            h.renderComponent(Input, {
                value,
                status: "warning",
                layout: "vertical",
                label: "搜索",
                prefixIcon: "search",
                clearable: true,
                onClear: () => {
                    value = "";
                },
                ...extra,
            }),
        ).find((node) => node.type === "t-input");
    let node = render();
    assert.equal(node.props.status, "warning");
    assert.equal(node.props.layout, "vertical");
    assert.equal(node.props.prefixIcon, "search");
    node.props.onClear({ detail: {} });
    assert.equal(render().props.value, "");
    assert.equal(render({ invalid: true, status: "success" }).props.status, "error");
});

test("空态支持换图标或图片，未配置时仍使用项目默认图标", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { EmptyState } = h.source("components/ui/empty-state.tsx");
    assert.equal(h.renderComponent(EmptyState, { title: "暂无内容" }).props.icon, "inbox");
    assert.equal(
        h.renderComponent(EmptyState, { title: "暂无结果", icon: "search" }).props.icon,
        "search",
    );
    const image = h.renderComponent(EmptyState, {
        title: "暂无结果",
        image: "/assets/empty.png",
        customStyle: "padding:0",
        className: "mt-4",
    });
    assert.equal(image.props.image, "/assets/empty.png");
    assert.equal(image.props.icon, undefined);
    assert.equal(image.props.customStyle, "padding:0");
    assert.equal(image.props.className, "mt-4");
});

test("输入框外观示例输入后可通过 clear 事件清空受控值", (t) => {
    const h = createHarness({ endpoint: "", token: "" });
    t.after(() => h.stop());
    const fields = elements(h.render("pages/dev/components/form/index.tsx"));
    const input = (id) => fields.find((item) => item.type === "t-input" && item.props.id === id);
    assert.equal(
        fields.some((item) => item.type === "Label"),
        false,
    );
    assert.equal(input("example-name").props.label, "名称 *");
    assert.equal(input("example-name").props.placeholder, "请输入名称");
    assert.equal(input("example-name").props.tips, undefined);
    assert.equal(input("example-error").props.label, "邮箱");
    assert.equal(input("example-error").props.status, "error");
    assert.equal(input("example-error").props.tips, "请输入有效的邮箱地址");
    assert.equal(input("example-disabled").props.label, "禁用状态");
    assert.equal(input("example-disabled").props.disabled, true);
    const node = () =>
        elements(h.render("pages/dev/components/form/index.tsx")).find(
            (item) => item.type === "t-input" && item.props.prefixIcon === "search",
        );
    node().props.onChange({ detail: { value: "订单" } });
    assert.equal(node().props.value, "订单");
    node().props.onClear({ detail: {} });
    assert.equal(node().props.value, "");
    assert.equal(h.state.requests.length, 0);
});

test("Tabs 同页展示下划线与标签两种样式，各自回填且保持独立状态", (t) => {
    const h = createHarness({ endpoint: "", token: "" });
    t.after(() => h.stop());
    const page = "pages/dev/components/navigation/index.tsx";
    const tabs = () => elements(h.render(page)).filter((node) => node.type === "t-tabs");
    assert.deepEqual(
        tabs().map((node) => node.props.theme),
        ["line", "tag"],
    );
    const initial = tabs()[0].props.value;
    const tag = tabs()[1];
    const panel = tag.props.children[1];
    tag.props.onChange({ detail: { value: panel.props.value, label: panel.props.label } });
    assert.equal(tabs()[1].props.value, panel.props.value);
    assert.equal(tabs()[0].props.value, initial);
    assert.equal(h.state.requests.length, 0);
});
