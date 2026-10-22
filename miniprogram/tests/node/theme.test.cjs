const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, elements } = require("./harness.cjs");

function fixture(t) {
    const h = createHarness();
    t.after(() => h.stop());
    return h;
}
function contrast(a, b) {
    const luminance = (hex) => {
        const rgb = hex
            .slice(1)
            .match(/../gu)
            .map((v) => parseInt(v, 16) / 255);
        const [r, g, blue] = rgb.map((v) =>
            v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
        );
        return r * 0.2126 + g * 0.7152 + blue * 0.0722;
    };
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}

test("项目分别覆盖亮暗配色和公共尺寸，默认正文对比度达标，官方状态色保留默认值", (t) => {
    const h = fixture(t);
    const { resolveTheme } = h.source("components/theme/resolve.ts");
    const custom = resolveTheme("light", {
        colors: { light: { primary: "#166534" } },
        metrics: { radius: 24 },
    });
    assert.equal(custom.colors.primary, "#166534");
    assert.equal(custom.style["--primary"], "#166534");
    assert.equal(custom.style["--radius"], "24rpx");
    assert.equal(custom.navigation.backgroundColor, custom.colors.background);
    assert.notEqual(resolveTheme("dark").colors.primary, custom.colors.primary);
    assert.notEqual(resolveTheme("light").colors.primary, custom.colors.primary);
    for (const mode of ["light", "dark"]) {
        const theme = resolveTheme(mode);
        assert.equal(theme.navigation.frontColor, mode === "dark" ? "#ffffff" : "#000000");
        for (const background of ["background", "card"]) {
            for (const text of ["foreground", "heading", "muted-foreground"]) {
                assert.ok(
                    contrast(theme.colors[background], theme.colors[text]) >= 4.5,
                    `${mode} ${background} ${text}`,
                );
            }
        }
        // 官方品牌和状态色的对比度不强制改写，避免试用时偏离 TD 默认视觉。
        assert.equal(theme.colors.primary, mode === "light" ? "#0052d9" : "#4582e6");
    }
});

test("主题来自系统，监听变化并在最后订阅退出时解除监听", (t) => {
    const h = fixture(t);
    const { createThemeStore } = h.source("components/theme/store.ts");
    let current = "dark";
    const callbacks = new Set();
    const store = createThemeStore({
        getAppBaseInfo: () => ({ theme: current }),
        onThemeChange: (callback) => callbacks.add(callback),
        offThemeChange: (callback) => callbacks.delete(callback),
    });
    assert.equal(store.getSnapshot(), "dark");
    let changes = 0;
    const unsubscribe = store.subscribe(() => changes++);
    const unsubscribeSecond = store.subscribe(() => changes++);
    assert.equal(callbacks.size, 1);
    current = "light";
    callbacks.forEach((callback) => callback({ theme: current }));
    assert.equal(store.getSnapshot(), "light");
    assert.equal(changes, 2);
    callbacks.forEach((callback) => callback({ theme: current }));
    callbacks.forEach((callback) => callback({ theme: "invalid" }));
    assert.equal(changes, 2);
    unsubscribe();
    assert.equal(callbacks.size, 1);
    current = "dark";
    store.refresh();
    assert.equal(store.getSnapshot(), "dark");
    assert.equal(changes, 3);
    current = "invalid";
    store.refresh();
    assert.equal(store.getSnapshot(), "dark");
    unsubscribeSecond();
    assert.equal(callbacks.size, 0);
    assert.equal("setMode" in store, false);
});

test("旧基础库可读系统主题，接口不可用或失败时安全降级", (t) => {
    const h = fixture(t);
    const { createThemeStore } = h.source("components/theme/store.ts");
    const legacy = createThemeStore({ getSystemInfoSync: () => ({ theme: "dark" }) });
    assert.equal(legacy.getSnapshot(), "dark");
    assert.equal(createThemeStore({}).getSnapshot(), "light");
    const broken = createThemeStore({
        getAppBaseInfo() {
            throw Error("unsupported");
        },
        getSystemInfoSync: () => ({ theme: "dark" }),
        onThemeChange() {
            throw Error("unsupported");
        },
    });
    assert.equal(broken.getSnapshot(), "dark");
    const unsubscribe = broken.subscribe(() => {});
    assert.doesNotThrow(() => broken.refresh());
    assert.doesNotThrow(unsubscribe);
});

test("原生外观同步处理失败，连续切换最终应用最后主题", async (t) => {
    const h = fixture(t);
    const { createNativeThemeSync } = h.source("components/theme/native.ts");
    const { resolveTheme } = h.source("components/theme/resolve.ts");
    const calls = [];
    let release;
    const gate = new Promise((r) => {
        release = r;
    });
    let first = true;
    const sync = createNativeThemeSync({
        async setNavigationBarColor(options) {
            calls.push(["nav", options]);
            if (first) {
                first = false;
                await gate;
                throw Error("unsupported");
            }
        },
        async setBackgroundColor(options) {
            calls.push(["background", options]);
        },
    });
    const pending = sync(resolveTheme("light"));
    sync(resolveTheme("dark"));
    sync(resolveTheme("light"));
    sync(resolveTheme("dark"));
    release();
    await pending;
    assert.equal(calls.filter(([kind]) => kind === "nav").at(-1)[1].frontColor, "#ffffff");
    assert.equal(
        calls.filter(([kind]) => kind === "background").at(-1)[1].backgroundColor,
        resolveTheme("dark").colors.background,
    );
    await assert.doesNotReject(sync(resolveTheme("light")));
    assert.equal(calls.filter(([kind]) => kind === "nav").at(-1)[1].frontColor, "#000000");
});

test("首页与子页跟随系统主题，后台恢复重新读取且无手动主题按钮", async (t) => {
    const h = fixture(t);
    h.state.storage.set("go-starter:ui-theme", "light");
    h.state.systemTheme = "dark";
    const root = (page) =>
        elements(h.render(page)).find((el) => el.props.className?.split(" ").includes("ui-page"));
    const pages = h.source("app.config.ts").default.pages.map((page) => `${page}.tsx`);
    for (const page of pages) assert.equal(root(page).props["data-theme"], "dark");
    assert.equal(h.themeListenerCount(), 1);
    h.changeTheme("light");
    for (const page of pages) {
        assert.equal(root(page).props["data-theme"], "light");
        assert.equal(
            elements(h.render(page)).some(
                (el) => el.type === "t-button" && ["亮色", "暗色"].includes(el.props.children),
            ),
            false,
        );
    }
    h.state.systemTheme = "dark";
    h.show();
    for (const page of pages) assert.equal(root(page).props["data-theme"], "dark");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.state.navigation.at(-1).frontColor, "#ffffff");
    h.stop();
    assert.equal(h.themeListenerCount(), 0);
});
