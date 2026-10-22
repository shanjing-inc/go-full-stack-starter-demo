const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, elements, texts } = require("./harness.cjs");

function fixture(t) {
    const h = createHarness({ endpoint: "", token: "" });
    t.after(() => h.stop());
    return h;
}
const home = "pages/index/index.tsx";
const root = (tree) => elements(tree).find((node) => node.props.className === "ui-page");
const popup = (h) => elements(h.render(home)).find((node) => node.type === "t-popup");
const choices = (h) => elements(h.render(home)).find((node) => node.type === "t-radio-group");
function open(h) {
    elements(h.render(home))
        .find((node) => node.type === "t-cell" && node.props.title === "字号设置")
        .props.onClick({ detail: {} });
}

test("首页提供小、标准、大三档，默认标准，选择即时预览并可关闭再打开", (t) => {
    const h = fixture(t);
    assert.equal(root(h.render(home)).props.style["--font-body"], "32rpx");
    open(h);
    assert.equal(popup(h).props.visible, true);
    assert.deepEqual(
        Array.from(choices(h).props.options, (option) => option.label),
        ["小", "标准", "大"],
    );
    assert.equal(choices(h).props.value, "standard");
    choices(h).props.onChange({ detail: { value: "large" } });
    assert.equal(choices(h).props.value, "large");
    assert.equal(root(h.render(home)).props.style["--font-body"], "36rpx");
    assert.match(texts(popup(h)), /预览/u);
    popup(h).props.onVisibleChange({ detail: { visible: false } });
    assert.equal(popup(h).props.visible, false);
    open(h);
    assert.equal(choices(h).props.value, "large");
    elements(popup(h))
        .find((node) => node.type === "t-button" && node.props.children === "完成")
        .props.onTap({});
    assert.equal(popup(h).props.visible, false);
    assert.equal(h.state.requests.length, 0);
});

test("字号在全部页面和亮暗主题中同步，返回前台保留选择及页面留白", (t) => {
    const h = fixture(t);
    const pages = h.source("app.config.ts").default.pages;
    for (const page of pages) h.render(`${page}.tsx`);
    for (const mode of ["light", "dark"]) {
        h.changeTheme(mode);
        for (const [value, sizes] of [
            ["small", [36, 32, 28, 24]],
            ["standard", [40, 36, 32, 28]],
            ["large", [44, 40, 36, 32]],
        ]) {
            choices(h).props.onChange({ detail: { value } });
            h.show();
            for (const page of pages) {
                const node = root(h.render(`${page}.tsx`));
                assert.equal(node.props["data-theme"], mode);
                for (const [index, name] of ["title", "section", "body", "caption"].entries()) {
                    assert.equal(node.props.style[`--font-${name}`], `${sizes[index]}rpx`, page);
                }
                assert.equal(node.props.style["--page-padding"], "32rpx");
                assert.equal(node.props.style["--card-padding"], "32rpx");
            }
        }
    }
});

test("本机保存所选字号，重新启动后无需登录即可恢复", (t) => {
    const h = fixture(t);
    const { FONT_SIZE_STORAGE_KEY } = h.source("components/theme/font-size-store.ts");
    choices(h).props.onChange({ detail: { value: "small" } });
    assert.equal(h.state.storage.get(FONT_SIZE_STORAGE_KEY), "small");
    const reopened = fixture(t);
    for (const [key, value] of h.state.storage) reopened.state.storage.set(key, value);
    assert.equal(root(reopened.render(home)).props.style["--font-body"], "28rpx");
    assert.equal(choices(reopened).props.value, "small");
    choices(reopened).props.onChange({ detail: { value: "standard" } });
    assert.equal(reopened.state.storage.get(FONT_SIZE_STORAGE_KEY), "standard");
});

test("无效或无法读取的偏好降级为标准，不会覆盖其他本机数据", (t) => {
    for (const stored of [undefined, "", "extra-large", 36, null, {}, ["large"]]) {
        const h = fixture(t);
        h.state.storage.set("go-starter:ui-font-size", stored);
        h.state.storage.set("other", "keep");
        assert.equal(choices(h).props.value, "standard");
        assert.equal(root(h.render(home)).props.style["--font-body"], "32rpx");
        assert.equal(h.state.storage.get("other"), "keep");
    }
    const h = fixture(t);
    h.state.storageReadError = true;
    assert.equal(choices(h).props.value, "standard");
});

test("保存失败时当前字号仍生效并给出提示，可直接重试保存", (t) => {
    const h = fixture(t);
    open(h);
    h.state.storageWriteError = true;
    choices(h).props.onChange({ detail: { value: "large" } });
    assert.equal(root(h.render(home)).props.style["--font-body"], "36rpx");
    assert.match(texts(popup(h)), /保存失败/u);
    h.state.storageWriteError = false;
    elements(popup(h))
        .find((node) => node.type === "t-button" && node.props.children === "重试保存")
        .props.onTap({});
    assert.doesNotMatch(texts(popup(h)), /保存失败/u);
    const { FONT_SIZE_STORAGE_KEY } = h.source("components/theme/font-size-store.ts");
    assert.equal(h.state.storage.get(FONT_SIZE_STORAGE_KEY), "large");
});

test("偏好通知仅在合法字号变化时触发，退订后停止通知", (t) => {
    const h = fixture(t);
    const { createFontSizeStore } = h.source("components/theme/font-size-store.ts");
    const values = new Map();
    const platform = {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
    };
    const store = createFontSizeStore(platform);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);
    assert.equal(store.getSnapshot(), "standard");
    assert.equal(store.setFontSize("extra-large"), false);
    assert.equal(store.setFontSize(null), false);
    assert.equal(store.setFontSize("large"), true);
    assert.equal(store.setFontSize("large"), true);
    assert.equal(notifications, 1);
    unsubscribe();
    store.setFontSize("small");
    assert.equal(notifications, 1);
    assert.equal(createFontSizeStore(platform).getSnapshot(), "small");
});

test("大字号同步官方文字及行高，按钮和图标标签栏增加高度，显式主题覆盖仍优先", (t) => {
    const h = fixture(t);
    const { resolveTheme } = h.source("components/theme/resolve.ts");
    for (const mode of ["light", "dark"]) {
        const standard = resolveTheme(mode);
        const large = resolveTheme(mode, undefined, "large");
        for (const [name, size, line] of [
            ["--td-font-body-large", 36, 54],
            ["--td-font-body-medium", 36, 50],
            ["--td-font-body-small", 32, 46],
            ["--td-font-body-extraSmall", 32, 38],
            ["--td-font-mark-large", 36, 54],
            ["--td-font-mark-medium", 36, 50],
            ["--td-font-title-large", 40, 54],
        ]) {
            assert.match(large.style[name], new RegExp(`^(400|500) ${size}rpx / ${line}rpx `));
        }
        assert.equal(large.style["--td-font-size-base"], "36rpx");
        assert.equal(large.style["--td-picker-item-font-size"], "36rpx");
        assert.equal(large.style["--td-cell-note-font-size"], "32rpx");
        assert.equal(large.style["--td-button-small-height"], "70rpx");
        assert.equal(large.style["--td-button-medium-height"], "86rpx");
        assert.equal(large.style["--td-button-large-height"], "102rpx");
        assert.equal(large.style["--td-tab-bar-height"], "86rpx");
        assert.equal(large.style["--td-checkbox-title-line-height"], "54rpx");
        assert.equal(standard.style["--td-button-medium-height"], undefined);
        const custom = resolveTheme(
            mode,
            {
                metrics: { "font-body": 40, "control-height": 100 },
                tdesign: { [mode]: { "--td-button-medium-height": "120rpx" } },
            },
            "large",
        );
        assert.equal(custom.style["--font-body"], "44rpx");
        assert.equal(custom.style["--td-button-medium-height"], "120rpx");
    }
});
