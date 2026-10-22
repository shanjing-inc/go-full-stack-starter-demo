const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, elements } = require("./harness.cjs");
const native = (tree) =>
    elements(tree).find((node) => /^t-(title|text|paragraph)$/.test(node.type));

test("文字复用官方组件，透传内容、省略、装饰和事件", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const typography = h.source("components/ui/typography.tsx");
    for (const [name, type] of [
        ["Title", "t-title"],
        ["Text", "t-text"],
        ["Paragraph", "t-paragraph"],
    ]) {
        let expanded;
        const ellipsis = { row: 2, expandable: true, collapsible: true };
        const node = native(
            h.renderComponent(typography[name], {
                content: "官方内容",
                children: "插槽",
                ellipsis,
                onExpand: (event) => {
                    expanded = event.detail.expanded;
                },
            }),
        );
        assert.equal(node.type, type);
        assert.equal(node.props.content, "官方内容");
        assert.equal(node.props.children, "插槽");
        assert.equal(node.props.ellipsis, ellipsis);
        node.props.onExpand({ detail: { expanded: false } });
        assert.equal(expanded, false);
        assert.equal(node.props.style.margin, 0);
    }
    let copied;
    const text = native(
        h.renderComponent(typography.Text, {
            size: "caption",
            theme: "secondary",
            strong: true,
            copyable: { text: "复制值" },
            onCopy: (event) => {
                copied = event.detail.text;
            },
        }),
    );
    assert.equal(text.props.size, undefined);
    assert.equal(text.props.style.fontSize, "var(--font-caption)");
    assert.equal(text.props.theme, "secondary");
    assert.equal(text.props.strong, true);
    assert.deepEqual(text.props.copyable, { text: "复制值" });
    text.props.onCopy({ detail: { text: "复制值" } });
    assert.equal(copied, "复制值");
});

test("四档字号使用主题变量，实例对象及字符串样式可以覆盖默认值", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Title, Text, Paragraph } = h.source("components/ui/typography.tsx");
    const render = (Component, props = {}) => native(h.renderComponent(Component, props));
    assert.equal(render(Title).props.style.fontSize, "var(--font-title)");
    assert.equal(render(Title, { level: "h5" }).props.style.fontSize, "var(--font-section)");
    assert.equal(render(Title, { level: "h2" }).props.style.fontSize, undefined);
    for (const Component of [Text, Paragraph]) {
        assert.equal(render(Component).props.style.fontSize, "var(--font-body)");
        assert.equal(
            render(Component, { size: "caption" }).props.style.fontSize,
            "var(--font-caption)",
        );
        const object = render(Component, {
            style: { fontSize: "30rpx", margin: "8rpx" },
        });
        assert.equal(object.props.style.fontSize, "30rpx");
        assert.equal(object.props.style.margin, "8rpx");
        const string = render(Component, {
            style: "font-size:30rpx;margin:8rpx",
            customStyle: "color:red",
        });
        assert.match(string.props.style, /;font-size:30rpx;margin:8rpx$/);
        assert.equal(string.props.customStyle, "color:red");
    }
});

test("页面与卡片文字的布局类作用于不受原生内联样式覆盖的容器", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const typography = h.source("components/ui/typography.tsx");
    for (const Component of Object.values(typography)) {
        const tree = h.renderComponent(Component, { className: "mt-2 block", children: "说明" });
        assert.equal(tree.type, "View");
        assert.ok(tree.props.className.split(/\s+/).includes("mt-2"));
        assert.ok(tree.props.className.split(/\s+/).includes("block"));
        assert.equal(tree.props.style?.margin, undefined);
        assert.equal(tree.props.style?.display, undefined);
        assert.equal(native(tree).props.style.margin, 0, "仅复位内部官方默认间距");
    }
    for (const page of ["pages/index/index.tsx", "pages/dev/design-system/index.tsx"]) {
        const nodes = elements(h.render(page));
        const layout = nodes.filter(
            (node) => node.type === "View" && /\bmt-[23]\b/.test(node.props.className),
        );
        assert.ok(
            layout.some((node) => native(node)),
            "实际页面的标题和说明保留间距容器",
        );
    }
});
