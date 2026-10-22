const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createHarness, elements, texts } = require("./harness.cjs");
const element = (tree, type) =>
    elements(tree).find((item) => item.type === type && item.props.id === "shop-query");
const buttons = (tree) =>
    elements(tree).filter(
        (item) => item.type === "t-button" && /^发送/u.test(String(item.props.children)),
    );
function fixture(t, options) {
    const h = createHarness({ token: "test-session", ...options });
    t.after(() => h.stop());
    return h;
}
const settle = (t, h) =>
    t.waitFor(
        () => {
            const actions = buttons(h.render());
            assert.equal(actions.length, 2);
            assert.ok(actions.every((button) => !button.props.disabled));
        },
        { interval: 10, timeout: 5000 },
    );

test("首页按规范、组件、请求排序，分类入口可达且页面沿用原生返回", (t) => {
    const h = fixture(t, { endpoint: "", token: "" });
    const config = h.source("app.config.ts").default;
    assert.deepEqual(Array.from(config.pages), [
        "pages/index/index",
        "pages/dev/design-system/index",
        "pages/dev/components/index",
        "pages/dev/components/basic/index",
        "pages/dev/components/navigation/index",
        "pages/dev/components/form/index",
        "pages/dev/components/content/index",
        "pages/dev/components/overlay/index",
        "pages/dev/batch-test/index",
    ]);
    assert.equal(config.darkmode, true);
    assert.equal(config.themeLocation, "components/theme/native.json");
    const native = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "../../src", config.themeLocation), "utf8"),
    );
    assert.equal(native.light.navigationText, "black");
    assert.equal(native.dark.navigationText, "white");
    assert.equal(config.window.navigationBarBackgroundColor, "@background");
    assert.equal(config.window.navigationBarTextStyle, "@navigationText");
    for (const page of config.pages) {
        assert.ok(fs.existsSync(path.resolve(__dirname, "../../src", `${page}.tsx`)));
        assert.ok(fs.existsSync(path.resolve(__dirname, "../../src", `${page}.config.ts`)));
    }
    const home = h.render("pages/index/index.tsx");
    const links = elements(home).filter((item) => item.type === "Navigator");
    assert.deepEqual(
        links.map((item) => item.props.url),
        [
            "/pages/dev/design-system/index",
            "/pages/dev/components/index",
            "/pages/dev/batch-test/index",
        ],
    );
    assert.ok(links.every((item) => item.props.openType === "navigate"));
    assert.match(texts(home), /批量请求测试/u);
    assert.match(texts(home), /设计规范/u);
    const gallery = h.render("pages/dev/components/index.tsx");
    const categories = elements(gallery).filter((item) => item.type === "Navigator");
    assert.deepEqual(
        categories.map((item) => item.props.url),
        [
            "/pages/dev/components/basic/index",
            "/pages/dev/components/navigation/index",
            "/pages/dev/components/form/index",
            "/pages/dev/components/content/index",
            "/pages/dev/components/overlay/index",
        ],
    );
    for (const link of [...links, ...categories]) {
        assert.ok(config.pages.includes(link.props.url.slice(1)));
        assert.equal(link.props.openType, "navigate");
    }
    for (const page of config.pages
        .slice(1)
        .filter((name) => name !== "pages/dev/components/index")) {
        const child = h.render(`${page}.tsx`);
        assert.equal(
            elements(child).some((item) => item.type === "Navigator"),
            false,
        );
    }
    assert.equal(h.state.requests.length, 0);
});

test("规范页只展示配色、排版与布局，组件反馈留在所属分类页面", (t) => {
    const h = fixture(t, { endpoint: "", token: "" });
    const spec = h.render("pages/dev/design-system/index.tsx");
    assert.match(texts(spec), /语义配色/u);
    assert.match(texts(spec), /文字与尺度/u);
    assert.match(texts(spec), /布局与间距/u);
    assert.equal(
        elements(spec).some(
            (node) =>
                typeof node.type === "string" &&
                node.type.startsWith("t-") &&
                !["t-title", "t-text", "t-paragraph"].includes(node.type),
        ),
        false,
    );
    const basic = "pages/dev/components/basic/index.tsx";
    elements(h.render(basic))
        .find((node) => node.type === "t-button" && node.props.children === "主要操作")
        .props.onTap({});
    assert.match(texts(h.render(basic)), /已点击：主要操作/u);
    const content = "pages/dev/components/content/index.tsx";
    elements(h.render(content))
        .find((node) => node.type === "t-button" && node.props.children === "开始体验")
        .props.onTap({});
    assert.match(texts(h.render(content)), /可以开始首次操作/u);
    assert.equal(h.state.requests.length, 0);
});
test("单次请求展示结果与总耗时，拦截重复点击，错误后允许重试", async (t) => {
    const h = fixture(t);
    element(h.render(), "t-input").props.onChange({ detail: { value: "1" } });
    const action = buttons(h.render())[0].props.onTap;
    action();
    action();
    assert.ok(buttons(h.render()).every((button) => button.props.disabled));
    await settle(t, h);
    assert.match(texts(h.render()), /测试店铺/);
    assert.match(texts(h.render()), /单个操作 总耗时 \d+ms，全部成功/);
    assert.equal(h.state.requests.length, 1);
    assert.equal(JSON.parse(h.state.requests[0].data).length, 1);
    h.state.mode = "network";
    buttons(h.render())[0].props.onTap();
    await settle(t, h);
    assert.match(texts(h.render()), /网络请求失败/);
    assert.match(texts(h.render()), /失败 1 个/);
    assert.ok(buttons(h.render()).every((button) => !button.props.disabled));
    h.state.mode = "empty";
    buttons(h.render())[0].props.onTap();
    await settle(t, h);
    assert.match(texts(h.render()), /暂无匹配/);
});
test("五条并发操作合并传输，逐项保序显示成功与错误", async (t) => {
    const h = fixture(t);
    h.state.mode = "partial";
    element(h.render(), "t-input").props.onChange({ detail: { value: "demo-shop" } });
    const action = buttons(h.render())[1].props.onTap;
    action();
    action();
    await settle(t, h);
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
    assert.equal(element(h.render(), "t-input").props.label, "店铺 ID 或 slug *");
    assert.equal(element(h.render(), "t-input").props.layout, "vertical");
    assert.equal(element(h.render(), "t-input").props.placeholder, "可输入数字 ID 或店铺标识");
    assert.equal(element(h.render(), "t-input").props.tips, "");
    buttons(h.render())[1].props.onTap();
    await settle(t, h);
    assert.match(element(h.render(), "t-input").props.tips, /请输入/);
    assert.equal(element(h.render(), "t-input").props.status, "error");
    assert.equal(h.state.requests.length, 0);
    element(h.render(), "t-input").props.onChange({ detail: { value: "1" } });
    buttons(h.render())[1].props.onTap();
    h.unload();
    // 卸载后 UI 不再更新；留出异步响应观察期，而非等待按钮恢复。
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.doesNotMatch(texts(h.render()), /测试店铺/);
    assert.doesNotMatch(texts(h.render()), /全部成功/);
});
test("缺少端点配置时展示配置指引与每项失败，保持重试可用", async (t) => {
    const h = fixture(t, { endpoint: "" });
    element(h.render(), "t-input").props.onChange({ detail: { value: "1" } });
    buttons(h.render())[1].props.onTap();
    await settle(t, h);
    assert.equal(h.state.requests.length, 0);
    assert.equal((texts(h.render()).match(/TARO_APP_GRAPHQL_ENDPOINT/gu) ?? []).length, 5);
    assert.match(texts(h.render()), /失败 5 个/);
    assert.ok(buttons(h.render()).every((button) => !button.props.disabled));
});

// 间距由布局容器负责，按钮自身 margin 重置不应让两个业务操作贴合。
test("批量请求操作沿用示例的纵向 gap 布局", (t) => {
    const h = fixture(t);
    const groups = elements(h.render()).filter(
        (item) =>
            item.type === "View" &&
            buttons(item).length === 2 &&
            item.props.className?.split(" ").includes("flex-col"),
    );
    assert.ok(groups.some((item) => item.props.className.split(" ").includes("gap-3")));
});

test("项目自定义成功配色后，登录和查询提示使用配对的成功背景与文字", async (t) => {
    for (const mode of ["light", "dark"]) {
        const h = fixture(t, { token: "" });
        h.state.systemTheme = mode;
        h.source("components/theme/project.ts").projectTheme.colors[mode] = {
            success: "#166534",
            "success-foreground": "#ffffff",
        };
        const input = (placeholder, value) =>
            elements(h.render())
                .find((item) => item.type === "t-input" && item.props.placeholder === placeholder)
                .props.onChange({ detail: { value } });
        input("邮箱", "user@example.test");
        input("密码", "password");
        elements(h.render())
            .find((item) => item.type === "t-button" && item.props.children === "登录")
            .props.onTap({});
        await settle(t, h);
        input("可输入数字 ID 或店铺标识", "1");
        buttons(h.render())[0].props.onTap({});
        await settle(t, h);
        const page = h.render();
        const style = elements(page).find((item) => item.props.className === "ui-page").props.style;
        assert.equal(style["--td-tag-success-light-color"], "#166534");
        assert.equal(style["--td-tag-success-color"], "#ffffff");
        for (const message of [/登录成功/u, /成功：测试店铺/u]) {
            const node = elements(page).find(
                (item) => item.type === "t-tag" && message.test(texts(item)),
            );
            assert.ok(node, `${mode} ${message}`);
            assert.ok(
                node.props.theme === "success" && node.props.variant === "light",
                `${mode} 提示必须成对使用成功背景和前景`,
            );
        }
    }
});
