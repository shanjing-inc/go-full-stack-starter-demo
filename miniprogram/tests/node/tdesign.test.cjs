const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, elements, texts } = require("./harness.cjs");

test("次要按钮项目配色同步正常态与伪元素边框，官方显式覆盖仍优先", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { resolveTheme } = h.source("components/theme/resolve.ts");
    const path = require("node:path");
    const css = require("node:fs").readFileSync(
        path.join(
            path.dirname(require.resolve("tdesign-miniprogram/package.json")),
            "miniprogram_dist/button/button.wxss",
        ),
        "utf8",
    );
    for (const selector of [".t-button--light", ".t-button--light::after"]) {
        const rule = css.match(
            new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]+\\}"),
        )[0];
        assert.match(rule, /border-color:var\(--td-button-light-border-color,/);
    }
    for (const mode of ["light", "dark"]) {
        const colors = { [mode]: { secondary: "#166534", "secondary-foreground": "#ffffff" } };
        const style = resolveTheme(mode, { colors }).style;
        assert.equal(style["--td-button-light-border-color"], style["--td-button-light-bg-color"]);
        assert.equal(style["--td-button-light-border-color"], "#166534");
        assert.equal(resolveTheme(mode).style["--td-button-light-border-color"], undefined);
        assert.equal(
            resolveTheme(mode, {
                colors,
                tdesign: { [mode]: { "--td-button-light-border-color": "#052e16" } },
            }).style["--td-button-light-border-color"],
            "#052e16",
        );
    }
});

test("状态标签保留标识与点击接口，对接官方 click 事件", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Tag } = h.source("components/ui/tag.tsx");
    let clicked = false;
    const node = h.renderComponent(Tag, {
        id: "status",
        style: { opacity: 0.8 },
        onClick: () => {
            clicked = true;
        },
        children: "已完成",
    });
    assert.equal(node.props.id, "status");
    assert.equal(node.props.style.opacity, 0.8);
    node.props.onClick({ detail: {} });
    assert.equal(clicked, true);
});

test("统一按钮采用 TDesign 视觉并把 tap 适配到业务点击，禁用和加载继续拦截", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Button } = h.source("components/ui/button.tsx");
    let clicks = 0;
    for (const props of [{}, { disabled: true }, { loading: true }]) {
        const button = h.renderComponent(Button, {
            ...props,
            variant: "outline",
            openType: "share",
            onClick: () => clicks++,
        });
        assert.equal(button.type, "t-button");
        assert.equal(button.props.variant, "outline");
        assert.equal(button.props.openType, "share");
        button.props.onTap({ detail: {} });
        assert.equal(clicks, 1);
    }
});

test("TDesign 输入事件、密码与键盘确认保持业务接口", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Input } = h.source("components/ui/input.tsx");
    let value, confirmed;
    const tree = h.renderComponent(Input, {
        password: true,
        confirmType: "done",
        onInput: (e) => {
            value = e.detail.value;
        },
        onConfirm: (e) => {
            confirmed = e.detail.value;
        },
    });
    const input = elements(tree).find((e) => e.type === "t-input");
    assert.ok(input);
    assert.equal(input.props.type, "password");
    assert.equal(input.props.confirmType, "done");
    input.props.onChange({ detail: { value: "测试值", cursor: 3, keyCode: 0 } });
    input.props.onEnter({ detail: { value: "测试值" } });
    assert.equal(value, "测试值");
    assert.equal(confirmed, "测试值");
});

test("系统主题使用官方默认视觉，项目覆盖同时提供 TDesign 变量", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { resolveTheme } = h.source("components/theme/resolve.ts");
    assert.equal(resolveTheme("light").colors.primary, "#0052d9");
    for (const mode of ["light", "dark"]) {
        const theme = resolveTheme(mode, {
            colors: { [mode]: { primary: "#166534", "primary-foreground": "#ffffff" } },
        });
        assert.equal(theme.style["--td-brand-color"], "#166534");
        assert.equal(theme.style["--td-button-primary-color"], "#ffffff");
        assert.ok(theme.style["--td-brand-color-active"]);
    }
});

test("示例通过官方事件关闭弹层，并回填选择器的确认值", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const page = "pages/dev/components/overlay/index.tsx";
    const node = (type) => elements(h.render(page)).find((e) => e.type === type);
    const click = (label) =>
        elements(h.render(page))
            .find((e) => e.type === "t-button" && e.props.children === label)
            .props.onTap({});
    click("打开对话框");
    assert.equal(node("t-dialog").props.visible, true);
    node("t-dialog").props.onConfirm({});
    assert.equal(node("t-dialog").props.visible, false);
    assert.match(texts(h.render(page)), /已确认操作/u);
    click("打开底部弹层");
    assert.equal(node("t-popup").props.visible, true);
    node("t-popup").props.onVisibleChange({ detail: { visible: false } });
    assert.equal(node("t-popup").props.visible, false);
    click("选择颜色");
    assert.equal(node("t-picker").props.visible, true);
    assert.equal(node("t-picker-item").props.options.length, 2);
    node("t-picker").props.onConfirm({ detail: { value: ["green"], label: ["绿色"] } });
    assert.equal(node("t-picker").props.visible, false);
    assert.equal(node("t-picker").props.value[0], "green");
});

test("项目官方变量覆盖最后生效，未定制时不重写组件默认尺寸", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { resolveTheme } = h.source("components/theme/resolve.ts");
    const original = resolveTheme("light");
    assert.equal(original.style["--td-button-medium-height"], undefined);
    const custom = resolveTheme("light", {
        colors: { light: { primary: "#166534" } },
        metrics: { "control-height": 96 },
        tdesign: { light: { "--td-brand-color-active": "#052e16" } },
    });
    assert.equal(custom.style["--td-button-medium-height"], "96rpx");
    assert.equal(custom.style["--td-brand-color-active"], "#052e16");
    assert.notEqual(custom.style["--td-brand-color-disabled"], original.colors.primary);
    assert.equal(resolveTheme("dark").style["--td-brand-color-active"], undefined);
});

test("按钮和标签将官方嵌套 tap 转回业务点击事件，并保留事件控制", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    for (const [file, name, callback] of [
        ["button", "Button", "onTap"],
        ["tag", "Tag", "onClick"],
    ]) {
        let received;
        let stopped = false;
        let prevented = false;
        const event = {
            detail: { detail: { x: 24, y: 48 }, touches: [{ identifier: 1 }], changedTouches: [] },
            currentTarget: { id: "action", dataset: { action: "save" } },
            stopPropagation() {
                stopped = true;
                assert.equal(this, event);
            },
            preventDefault() {
                prevented = true;
                assert.equal(this, event);
            },
        };
        const tree = h.renderComponent(h.source(`components/ui/${file}.tsx`)[name], {
            onClick: (e) => {
                received = e;
                e.stopPropagation();
                e.preventDefault();
            },
        });
        tree.props[callback](event);
        assert.deepEqual(received.detail, { x: 24, y: 48 });
        assert.equal(received.touches[0].identifier, 1);
        assert.equal(received.currentTarget.dataset.action, "save");
        assert.ok(stopped && prevented);
    }
});

test("按钮保留实时手机号与服务动态开放能力回调", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Button } = h.source("components/ui/button.tsx");
    let phone, activity;
    const tree = h.renderComponent(Button, {
        onGetRealTimePhoneNumber: (event) => {
            phone = event.detail.code;
        },
        onCreateLiveActivity: (event) => {
            activity = event.detail.code;
        },
    });
    tree.props.onGetrealtimephonenumber({ detail: { code: "phone" } });
    tree.props.onCreateliveactivity({ detail: { code: "activity" } });
    assert.equal(phone, "phone");
    assert.equal(activity, "activity");
});

test("输入框 defaultValue 初始化一次，受控 value 优先且空字符串可清空", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { Input } = h.source("components/ui/input.tsx");
    const render = (props) =>
        elements(h.renderComponent(Input, props)).find((e) => e.type === "t-input");
    assert.equal(render({ defaultValue: "初始值" }).props.value, "初始值");
    assert.equal(render({ defaultValue: "后续默认值" }).props.value, "初始值");
    assert.equal(render({ defaultValue: "默认值", value: "受控值" }).props.value, "受控值");
    assert.equal(render({ defaultValue: "默认值", value: "" }).props.value, "");
});

test("自定义危险色同步按下、禁用与浅色标签，官方变量仍优先", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { resolveTheme } = h.source("components/theme/resolve.ts");
    for (const mode of ["light", "dark"]) {
        const theme = resolveTheme(mode, { colors: { [mode]: { destructive: "#7e22ce" } } });
        for (const key of [
            "--td-error-color-active",
            "--td-button-danger-disabled-bg",
            "--td-button-danger-disabled-border-color",
            "--td-tag-danger-light-color",
        ]) {
            assert.match(theme.style[key], /^#[0-9a-f]{6}$/u, key);
        }
        assert.notEqual(theme.style["--td-error-color-active"], "#7e22ce");
        assert.equal(
            theme.style["--td-button-danger-disabled-bg"],
            theme.style["--td-button-danger-disabled-border-color"],
        );
        assert.equal(resolveTheme(mode).style["--td-error-color-active"], undefined);
        const explicit = resolveTheme(mode, {
            colors: { [mode]: { destructive: "#7e22ce" } },
            tdesign: { [mode]: { "--td-error-color-active": "#581c87" } },
        });
        assert.equal(explicit.style["--td-error-color-active"], "#581c87");
    }
});
