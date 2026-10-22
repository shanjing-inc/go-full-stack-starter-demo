import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { createContext } from "weapp-tailwindcss/core";
import register, {
    prepareTDesign,
    createTDesignCompatibility,
} from "../../config/plugins/tdesign.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);

test("官方动态图片模板经过 Vite 兼容处理后逐字恢复，无构建占位地址", async (t) => {
    const fixture = await mkdtemp(path.join(tmpdir(), "weapp-tdesign-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    await writeFile(path.join(fixture, "package.json"), "{}");
    await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
    prepareTDesign(fixture);
    const official = path.join(
        path.dirname(require.resolve("tdesign-miniprogram/package.json")),
        "miniprogram_dist",
    );
    const bundle = {};
    for (const file of await readdir(official, { recursive: true })) {
        if (!file.endsWith(".wxml")) continue;
        bundle[file] = {
            type: "asset",
            fileName: file,
            source: await readFile(path.join(fixture, "src/native/tdesign", file), "utf8"),
        };
    }
    assert.ok(bundle["icon/icon.wxml"].source.includes("https://tdesign-build.invalid/"));
    const plugin = createTDesignCompatibility(fixture);
    plugin.generateBundle.handler({}, bundle);
    // 完整输出和增量重建都保留页面样式与同一份完整的官方亮暗主题。
    for (const pageStyle of ['@import "./app-origin.wxss";', ".ui-page { color: red; }"]) {
        await writeFile(path.join(fixture, "app.wxss"), pageStyle);
        plugin.writeBundle.handler({ dir: fixture });
        assert.equal(
            await readFile(path.join(fixture, "app.wxss"), "utf8"),
            '@import "./tdesign-theme.wxss";\n' + pageStyle,
        );
        assert.equal(
            await readFile(path.join(fixture, "tdesign-theme.wxss"), "utf8"),
            await readFile(path.join(official, "common/style/theme/_index.wxss"), "utf8"),
        );
    }
    for (const file of Object.keys(bundle)) {
        assert.equal(bundle[file].source, await readFile(path.join(official, file), "utf8"), file);
    }
    const native = path.join(fixture, "src/native/tdesign/input/input");
    const transformed = plugin.load(native + ".js?isNativeScript=comp");
    assert.match(transformed, /input\.css\?tdesign-native-style/u);
    assert.match(
        plugin.transform(
            `import "${native}.scss?isNativeStyle=true";`,
            native + ".js?isNativeScript=comp",
        ).code,
        /input\.css\?tdesign-native-style/u,
    );
    const watched = [];
    const css = plugin.load.call(
        { addWatchFile: (file) => watched.push(file) },
        native + ".css?tdesign-native-style",
    );
    assert.ok(watched.some((file) => file.endsWith("common/style/index.wxss")));
    assert.doesNotMatch(css, /@import/u);
    assert.match(css, /--td-input-placeholder-text-font/u);
});

function nativeTemplate(withScript = false, extraComponents = new Map()) {
    let callback, configureVite;
    register({
        modifyComponentConfig: (fn) => {
            callback = fn;
        },
        modifyViteConfig: (fn) => {
            configureVite = fn;
        },
    });
    const config = {
        includes: new Set(["view", "text"]),
        exclude: new Set(),
        thirdPartyComponents: new Map(extraComponents),
        includeAll: false,
    };
    callback({ componentConfig: config });
    const { UnRecursiveTemplate } = require("@tarojs/shared/dist/template");
    const template = new UnRecursiveTemplate();
    configureVite?.({
        viteConfig: { plugins: [] },
        viteCompilerContext: { sourceDir: path.join(root, "src"), taroConfig: { template } },
    });
    const wxml = template.buildTemplate(config);
    return withScript ? { wxml, script: template.buildXScript() } : wxml;
}

test("真实 Taro 原生模板包含 spread 属性及准确的官方事件名称", () => {
    const wxml = nativeTemplate();
    const tag = (name) => wxml.match(new RegExp(`<${name}\\s[^>]*>`))[0];
    assert.match(tag("t-button"), /open-type=/u);
    assert.match(tag("t-button"), /bindtap="eh"/u);
    assert.match(tag("t-button"), /bindgetuserinfo="eh"/u);
    assert.match(tag("t-button"), /bindgetrealtimephonenumber="eh"/u);
    assert.match(tag("t-button"), /bindcreateliveactivity="eh"/u);
    assert.match(tag("t-input"), /confirm-type=/u);
    assert.match(tag("t-input"), /bindchange="eh"/u);
    assert.match(tag("t-input"), /bindenter="eh"/u);
    assert.match(tag("t-input"), /bindclear="eh"/u);
    assert.match(tag("t-input"), /bindkeyboardheightchange="eh"/u);
    assert.match(tag("t-tag"), /bindclick="eh"/u);
    assert.match(tag("t-tag"), /bindclose="eh"/u);
    assert.match(tag("t-popup"), /bind:visible-change="eh"/u);
    assert.match(tag("t-picker-item"), /options=/u);
    for (const name of ["t-switch", "t-checkbox-group", "t-radio-group", "t-textarea"]) {
        assert.match(tag(name), /value=/u);
        assert.match(tag(name), /bindchange="eh"/u);
        assert.match(tag(name), /disabled=/u);
    }
    assert.match(tag("t-textarea"), /bindenter="eh"/u);
    assert.match(tag("t-textarea"), /bind:line-change="eh"/u);
    assert.match(tag("t-cell"), /bindclick="eh"/u);
    assert.match(tag("t-checkbox-group"), /options=/u);
    assert.match(tag("t-divider"), /dashed=/u);
    assert.match(tag("t-tabs"), /bindchange="eh"/u);
    assert.match(tag("t-tabs"), /bindclick="eh"/u);
    assert.match(tag("t-tabs"), /bindscroll="eh"/u);
    assert.match(tag("t-tab-panel"), /lazy=/u);
    assert.match(tag("t-tab-panel"), /disabled=/u);
    assert.match(tag("t-tab-bar"), /bindchange="eh"/u);
    assert.match(tag("t-tab-bar"), /safe-area-inset-bottom=/u);
    assert.match(tag("t-tab-bar-item"), /badge-props=/u);
    assert.match(tag("t-tab-bar-item"), /sub-tab-bar=/u);
});

test("原生模板传递 SuperComponent 动态补充的无障碍名称", () => {
    const wxml = nativeTemplate();
    for (const name of ["t-button", "t-input", "t-cell", "t-checkbox-group"]) {
        const tag = wxml.match(new RegExp(`<${name}\\s[^>]*>`))[0];
        assert.equal(
            templateValue(wxml, name, "aria-label", { ariaLabel: "控件名称" }),
            "控件名称",
        );
    }
});

test("官方文字属性与事件经真实模板绑定，缺省内容不产生 null 警告", () => {
    const wxml = nativeTemplate();
    for (const name of ["t-title", "t-text", "t-paragraph"]) {
        const tag = wxml.match(new RegExp(`<${name}\\s[^>]*>`))[0];
        assert.match(tag, /bindexpand="eh"/);
        assert.equal(templateValue(wxml, name, "content"), "");
        assert.equal(templateValue(wxml, name, "content", { content: "官方正文" }), "官方正文");
        assert.deepEqual(templateValue(wxml, name, "ellipsis", { ellipsis: { row: 2 } }), {
            row: 2,
        });
    }
    assert.match(wxml.match(/<t-text\s[^>]*>/)[0], /bindcopy="eh"/);
    assert.equal(templateValue(wxml, "t-title", "level", { level: "h5" }), "h5");
    assert.equal(templateValue(wxml, "t-text", "theme", { theme: "secondary" }), "secondary");
});

test("官方外观配置通过真实 Taro 模板保留显式值，支持继续增加样式示例", () => {
    const wxml = nativeTemplate();
    for (const [component, attribute, data, expected] of [
        ["t-tabs", "theme", { theme: "tag" }, "tag"],
        ["t-tabs", "space-evenly", { spaceEvenly: false }, false],
        [
            "t-tabs",
            "sticky-props",
            { stickyProps: { offsetTop: 20, zIndex: 2 } },
            { offsetTop: 20, zIndex: 2 },
        ],
        ["t-button", "variant", { variant: "dashed" }, "dashed"],
        ["t-button", "shape", { shape: "round" }, "round"],
        ["t-tag", "variant", { variant: "light-outline" }, "light-outline"],
        ["t-input", "layout", { layout: "vertical" }, "vertical"],
        ["t-input", "status", { status: "warning" }, "warning"],
        ["t-empty", "image", { image: "/assets/empty.png" }, "/assets/empty.png"],
    ]) {
        assert.deepEqual(templateValue(wxml, component, attribute, data), expected);
    }
});

let xs;
function templateValue(wxml, component, attribute, data = {}) {
    if (!xs) {
        const module = { exports: {} };
        vm.runInNewContext(nativeTemplate(true).script, { module });
        xs = module.exports;
    }
    const tag = wxml.match(new RegExp(`<${component}\\s[^>]*>`))[0];
    const value = tag.match(new RegExp(`\\s${attribute}="([^"]*)"`))[1];
    assert.ok(
        value.startsWith("{{") && value.endsWith("}}"),
        `${component}.${attribute} 属性边界完整`,
    );
    return vm.runInNewContext(value.slice(2, -2), { i: data, xs });
}

test("未传原生属性使用官方默认值，避免字符串等类型收到 null 并保留控件默认行为", () => {
    const plugin = createTDesignCompatibility(root);
    const bundle = {
        base: { type: "asset", fileName: "base.wxml", source: nativeTemplate() },
    };
    plugin.generateBundle.handler({}, bundle);
    const wxml = bundle.base.source;
    for (const [component, attribute, expected] of [
        ["t-button", "open-type", ""],
        ["t-button", "lang", ""],
        ["t-button", "hover-start-time", 20],
        ["t-button", "need-show-entrance", true],
        ["t-input", "placeholder", ""],
        ["t-input", "cursor", -1],
        ["t-input", "adjust-position", true],
        ["t-popup", "placement", "top"],
        ["t-popup", "show-overlay", true],
        ["t-button", "aria-label", ""],
        ["t-button", "aria-hidden", false],
    ]) {
        assert.equal(
            templateValue(wxml, component, attribute),
            expected,
            `${component}.${attribute}`,
        );
    }
    assert.equal(templateValue(wxml, "t-switch", "custom-value").join(","), "true,false");
    assert.equal(Object.keys(templateValue(wxml, "t-popup", "overlay-props")).length, 0);
    assert.equal(templateValue(wxml, "t-checkbox-group", "default-value").length, 0);
    const official = path.join(
        path.dirname(require.resolve("tdesign-miniprogram/package.json")),
        "miniprogram_dist",
    );
    for (const [, name] of nativeTemplate().matchAll(/<(t-[\w-]+)\s/g)) {
        const component = name.slice(2);
        const props = require(path.join(official, component, "props.js")).default;
        for (const [prop, definition] of Object.entries(props)) {
            if (![String, Number, Boolean].includes(definition.type)) continue;
            const attr = prop.replace(/[A-Z]/g, (x) => "-" + x.toLowerCase());
            const expected = definition.value === undefined ? definition.type() : definition.value;
            assert.equal(templateValue(wxml, name, attr), expected, `${name}.${prop}`);
        }
    }
});

test("TD style 的缺省和清空均传空字符串，已有内联样式保留且不影响其他组件", () => {
    const wxml = nativeTemplate(false, new Map([["other-widget", new Set(["style"])]]));
    for (const [, name] of wxml.matchAll(/<(t-[\w-]+)\s/g)) {
        assert.equal(templateValue(wxml, name, "style"), "", name);
        assert.equal(templateValue(wxml, name, "style", { st: null }), "", name);
        assert.equal(templateValue(wxml, name, "style", { st: "" }), "", name);
        assert.equal(
            templateValue(wxml, name, "style", { st: "color:red;--brand:#0052d9" }),
            "color:red;--brand:#0052d9",
            name,
        );
        const tag = wxml.match(new RegExp(`<${name}\\s[^>]*>`))[0];
        assert.equal([...tag.matchAll(/\sstyle=/g)].length, 1, name);
    }
    assert.equal(templateValue(wxml, "other-widget", "style"), undefined);
    assert.equal(templateValue(wxml, "other-widget", "style", { st: "opacity:0" }), "opacity:0");
});

test("使用 Taro 官方默认值管线，Vite 不再二次改写宿主模板", () => {
    const wxml = nativeTemplate();
    assert.match(wxml, /open-type="\{\{xs\.b\(i\.openType,''\)\}\}"/);
    assert.match(wxml, /overlay-props="\{\{xs\.b\(i\.overlayProps,xs\.d\(\)\)\}\}"/);
    const bundle = { base: { type: "asset", fileName: "base.wxml", source: wxml } };
    createTDesignCompatibility(root).generateBundle.handler({}, bundle);
    assert.equal(bundle.base.source, wxml);
});

test("Input 的表单行为名称经包装与真实模板传递，缺省为字符串", () => {
    const { createHarness, elements } = require("./harness.cjs");
    const h = createHarness();
    try {
        const { Input } = h.source("components/ui/input.tsx");
        const input = elements(h.renderComponent(Input, { name: "email" })).find(
            (element) => element.type === "t-input",
        );
        const wxml = nativeTemplate();
        assert.equal(templateValue(wxml, "t-input", "name", input.props), "email");
        assert.equal(templateValue(wxml, "t-input", "name"), "");
        assert.equal(templateValue(wxml, "t-input", "name", { name: "" }), "");
    } finally {
        h.stop();
    }
});

test(
    "微信 WXML 编译器接受完整默认值模板并拒绝旧的空对象表达式",
    {
        skip: process.env.WEAPP_WXML_COMPILER
            ? false
            : "未配置 WEAPP_WXML_COMPILER，微信编译器专项需本地执行",
    },
    async (t) => {
        const fixture = await mkdtemp(
            path.join(process.env.WEAPP_WXML_FIXTURE_ROOT ?? tmpdir(), "tdesign-wcc-"),
        );
        t.after(() => rm(fixture, { recursive: true, force: true }));
        const { wxml, script } = nativeTemplate(true);
        const source = '<wxs module="xs" src="./utils.wxs"/>\n' + wxml;
        await writeFile(path.join(fixture, "base.wxml"), source);
        await writeFile(path.join(fixture, "utils.wxs"), script);
        const compile = () =>
            spawnSync(
                process.env.WEAPP_WXML_COMPILER,
                ["base.wxml", "utils.wxs", "-o", "compiled.js"],
                { cwd: fixture, encoding: "utf8" },
            );
        const good = compile();
        assert.equal(good.status, 0, good.error?.message ?? good.stderr);
        assert.ok((await readFile(path.join(fixture, "compiled.js"))).length > 0);
        const broken = source.replace(
            'overlay-props="{{xs.b(i.overlayProps,xs.d())}}"',
            'overlay-props="{{i.overlayProps===undefined?{}:i.overlayProps}}"',
        );
        assert.notEqual(broken, source);
        await writeFile(path.join(fixture, "base.wxml"), broken);
        const bad = compile();
        assert.notEqual(bad.status, 0);
        assert.match(bad.stderr, /unexpected token.*\}/);
    },
);

test("模板默认值不会覆盖显式空字符串、false、0 或非受控状态的 null", () => {
    const plugin = createTDesignCompatibility(root);
    const bundle = {
        base: { type: "asset", fileName: "base.wxml", source: nativeTemplate() },
    };
    plugin.generateBundle.handler({}, bundle);
    const wxml = bundle.base.source;
    assert.equal(templateValue(wxml, "t-button", "size", { size: "" }), "");
    assert.equal(templateValue(wxml, "t-button", "open-type", { openType: "share" }), "share");
    assert.equal(
        templateValue(wxml, "t-input", "adjust-position", { adjustPosition: false }),
        false,
    );
    assert.equal(templateValue(wxml, "t-input", "cursor", { cursor: 0 }), 0);
    assert.equal(templateValue(wxml, "t-popup", "visible"), null);
    assert.equal(templateValue(wxml, "t-popup", "visible", { visible: null }), null);
    assert.equal(templateValue(wxml, "t-checkbox-group", "value"), null);
    assert.equal(templateValue(wxml, "t-radio-group", "value", { value: null }), null);
    assert.equal(templateValue(wxml, "t-picker", "cancel-btn", { cancelBtn: null }), null);
    // 重复处理及 watch 重用同一模板时不叠加表达式。
    plugin.generateBundle.handler({}, bundle);
    assert.equal(bundle.base.source, wxml);
});

test("默认值通过真实 Tailwind WXML 处理后属性边界完整，页面文字及表达式保持可解析", async () => {
    const plugin = createTDesignCompatibility(root);
    const bundle = {
        base: { type: "asset", fileName: "base.wxml", source: nativeTemplate() },
    };
    plugin.generateBundle.handler({}, bundle);
    const context = createContext({
        appType: "taro",
        tailwindcssBasedir: root,
        cssEntries: [path.join(root, "src/app.css")],
    });
    const transformed = await context.transformWxml(bundle.base.source, { runtimeSet: new Set() });
    assert.equal(templateValue(transformed, "t-button", "hover-class"), "");
    assert.equal(templateValue(transformed, "t-button", "send-message-img"), "截图");
    assert.equal(templateValue(transformed, "t-input", "placeholder-class"), "input-placeholder");
    for (const [, name] of transformed.matchAll(/<(t-[\w-]+)\s/g)) {
        const tag = transformed.match(new RegExp(`<${name}\\s[^>]*>`))[0];
        for (const [, attr, value] of tag.matchAll(/\s([\w:-]+)="([^"]*)"/g)) {
            if (!value.startsWith("{{")) continue;
            templateValue(transformed, name, attr);
        }
    }
});
