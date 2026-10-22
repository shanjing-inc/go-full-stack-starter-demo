const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { createHarness, elements, texts } = require("./harness.cjs");

const official = path.join(
    path.dirname(require.resolve("tdesign-miniprogram/package.json")),
    "miniprogram_dist",
);

// 执行官方类及 relations 回调；事件分发、setData 与布局测量隔离于微信平台。
function nativeComponent(name, props = {}) {
    const module = { exports: {} };
    const source = ts.transpileModule(
        fs.readFileSync(path.join(official, name, name + ".js"), "utf8"),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
    ).outputText;
    const importModule = (id) => {
        if (id === "tslib") return require(id);
        if (id === "../common/src/index")
            return { SuperComponent: class {}, wxComponent: () => (component) => component };
        if (id === "./props") return require(path.join(official, name, "props.js"));
        if (id === "../common/config") return { default: { prefix: "t" } };
        if (id === "../common/utils") return { uniqueFactory: () => () => "example-tabs" };
        return {};
    };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`)(
        importModule,
        module,
        module.exports,
    );
    const self = new module.exports.default();
    const defaults = Object.fromEntries(
        Object.entries(self.properties).map(([key, prop]) => [
            key,
            prop.value === undefined
                ? { String: "", Number: 0, Boolean: false, Array: [], Object: null }[
                      prop.type?.name
                  ]
                : structuredClone(prop.value),
        ]),
    );
    self.properties = { ...defaults, ...props };
    self.data = { ...self.data, ...self.properties };
    Object.assign(self, self.methods);
    self.events = [];
    self.$children = [];
    self.setData = function (patch, callback) {
        Object.assign(this.data, patch);
        callback?.();
    };
    self._trigger = (name, detail) => self.events.push({ name, detail });
    self.setTrack = () => {};
    self.lifetimes?.created?.call(self);
    return self;
}

test("Tabs 保留内容节点、禁用/lazy、数字 value 与官方事件；TabBar 保留定位及安全区配置", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Tabs, TabPanel } = h.source("components/ui/tabs.tsx");
    let changed;
    const panel = h.renderComponent(TabPanel, {
        value: 0,
        label: "概览",
        lazy: true,
        children: "内容",
    });
    assert.equal(panel.type, "t-tab-panel");
    assert.equal(panel.props.children, "内容");
    assert.equal(panel.props.lazy, true);
    const tabs = h.renderComponent(Tabs, {
        value: 0,
        children: panel,
        onChange: (e) => {
            changed = e.detail;
        },
    });
    assert.equal(tabs.type, "t-tabs");
    assert.equal(tabs.props.value, 0);
    assert.equal(tabs.props.children.type, "t-tab-panel");
    tabs.props.onChange({ detail: { value: 1, label: "详情" } });
    assert.deepEqual(changed, { value: 1, label: "详情" });
    const { TabBar, TabBarItem } = h.source("components/ui/tab-bar.tsx");
    const item = h.renderComponent(TabBarItem, {
        value: "home",
        icon: "home",
        badgeProps: { count: 2 },
        children: "首页",
    });
    const bar = h.renderComponent(TabBar, {
        fixed: false,
        placeholder: true,
        safeAreaInsetBottom: false,
        children: item,
    });
    assert.equal(bar.type, "t-tab-bar");
    assert.equal(bar.props.fixed, false);
    assert.equal(bar.props.placeholder, true);
    assert.equal(bar.props.safeAreaInsetBottom, false);
    assert.equal(bar.props.children.type, "t-tab-bar-item");
    assert.equal(item.props.icon, "home");
    assert.equal(item.props.badgeProps.count, 2);
    assert.equal(item.props.children, "首页");
});

test("官方 Tabs 父子方法切换内容面板，禁用标签不触发 change，lazy 面板记录首次激活", () => {
    const tabs = nativeComponent("tabs", { value: "overview" });
    const panels = [
        nativeComponent("tab-panel", { value: "overview", label: "概览" }),
        nativeComponent("tab-panel", { value: "detail", label: "详情", lazy: true }),
        nativeComponent("tab-panel", { value: "disabled", label: "未开放", disabled: true }),
    ];
    for (const panel of panels) {
        panel.$parent = tabs;
        tabs.relations["../tab-panel/tab-panel"].linked.call(tabs, panel);
    }
    assert.equal(panels[0].data.active, true);
    assert.equal(panels[1].data.hide, true);
    assert.equal(panels[1].data.hasActivated, false);
    tabs.changeIndex(2);
    assert.equal(
        tabs.events.some((e) => e.name === "change"),
        false,
    );
    tabs.changeIndex(1);
    const change = tabs.events.find((e) => e.name === "change");
    assert.equal(change.detail.value, "detail");
    tabs.properties.value = change.detail.value;
    tabs.observers.value.call(tabs, change.detail.value);
    assert.equal(panels[0].data.hide, true);
    assert.equal(panels[1].data.active, true);
    assert.equal(panels[1].data.hasActivated, true);
    tabs.properties.value = "overview";
    tabs.observers.value.call(tabs, "overview");
    assert.equal(panels[1].data.hide, true);
    assert.equal(panels[1].data.hasActivated, true);
});

test("官方 TabBar 子项选择发出 value，受控回填更新各项选中态", () => {
    const bar = nativeComponent("tab-bar", { value: "home", fixed: false });
    const items = ["home", "category", "profile"].map((value) =>
        nativeComponent("tab-bar-item", { value }),
    );
    bar.$children = items;
    for (const item of items) {
        item.$parent = bar;
        item.relations["../tab-bar/tab-bar"].linked.call(item, bar);
    }
    assert.equal(items[0].data.isChecked, true);
    items[1].toggle();
    assert.equal(bar.events[0].detail.value, "category");
    bar.data.value = "category";
    bar.observers.value.call(bar);
    assert.equal(items[0].data.isChecked, false);
    assert.equal(items[1].data.isChecked, true);
});

test("导航示例支持内容操作、选项卡与标签栏回填，不改变页面路由或访问后端", (t) => {
    const h = createHarness({ endpoint: "", token: "" });
    t.after(() => h.stop());
    const page = "pages/dev/components/navigation/index.tsx";
    const node = (type, predicate = () => true) =>
        elements(h.render(page)).find((e) => e.type === type && predicate(e));
    assert.equal(node("t-tabs").props.value, "overview");
    assert.equal(node("t-tab-panel", (e) => e.props.value === "detail").props.lazy, true);
    node("t-button", (e) => e.props.children === "记录操作").props.onTap({});
    assert.match(texts(h.render(page)), /已记录 1 次操作/u);
    node("t-tabs").props.onChange({ detail: { value: "detail", label: "详情" } });
    assert.equal(node("t-tabs").props.value, "detail");
    assert.match(texts(h.render(page)), /已记录 1 次操作/u);
    node("t-button", (e) => e.props.children === "返回概览").props.onTap({});
    assert.equal(node("t-tabs").props.value, "overview");
    node("t-tab-bar").props.onChange({ detail: { value: "category" } });
    assert.equal(node("t-tab-bar").props.value, "category");
    assert.match(texts(h.render(page)), /当前栏目：分类/u);
    assert.equal(node("t-tab-bar").props.fixed, false);
    assert.equal(node("t-tab-bar").props.safeAreaInsetBottom, false);
    assert.equal(
        elements(h.render(page)).some((e) => e.type === "t-tab-bar-item" && e.props.url),
        false,
    );
    assert.equal(h.state.requests.length, 0);
});

test("图标标签文字沿用辅助字号，Tabs 与 TabBar 选中态消费项目品牌变量", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { resolveTheme } = h.source("components/theme/resolve.ts");
    for (const mode of ["light", "dark"]) {
        const theme = resolveTheme(mode, {
            colors: { [mode]: { primary: "#166534" } },
            metrics: { "font-caption": 26 },
        });
        assert.match(theme.style["--td-font-body-extraSmall"], /^400 26rpx \/ 32rpx /);
        assert.equal(theme.style["--td-brand-color"], "#166534");
    }
    const css = fs.readFileSync(path.join(official, "tab-bar-item/tab-bar-item.wxss"), "utf8");
    assert.match(css, /var\(--td-font-body-extraSmall,/);
    assert.match(css, /var\(--td-tab-bar-active-color,var\(--td-brand-color,/);
    assert.match(
        fs.readFileSync(path.join(official, "tabs/tabs.wxss"), "utf8"),
        /var\(--td-tab-item-active-color,var\(--td-brand-color,/,
    );
});
