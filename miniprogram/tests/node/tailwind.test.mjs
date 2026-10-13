import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
    createWeappTailwindcssGenerator,
    resolveTailwindV4Source,
} from "weapp-tailwindcss/generator";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cssFile = path.join(root, "src/app.css");

test("小程序与 Web 对齐 Tailwind v4，主题与扫描配置集中在 CSS 入口", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const frontend = JSON.parse(
        await readFile(path.join(root, "../frontend/package.json"), "utf8"),
    );
    assert.equal(manifest.devDependencies.tailwindcss, "4.2.2");
    assert.equal(manifest.devDependencies.tailwindcss, frontend.devDependencies.tailwindcss);
    const css = await readFile(cssFile, "utf8");
    assert.match(css, /@import "tailwindcss" source\(none\);/u);
    assert.match(css, /@source "\.\/";/u);
    assert.match(css, /@theme\s*\{[^}]*--color-primary: #087f5b;/u);
    assert.doesNotMatch(css, /@config/u);
    await assert.rejects(readFile(path.join(root, "tailwind.config.js")), { code: "ENOENT" });
});

test("真实 v4 生成器读取 CSS 主题、隔离扫描范围并输出小程序 rpx 样式", async (t) => {
    const fixture = await mkdtemp(path.join(tmpdir(), "weapp-tailwind-v4-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
    for (const [directory, content] of [
        ["src", '<View className="bg-primary text-primary p-6 bg-white w-[13px]" />'],
        ["dist", '<View className="bg-orange-950" />'],
        ["docs", '<View className="text-pink-950" />'],
        ["tests", '<View className="text-lime-950" />'],
    ]) {
        await mkdir(path.join(fixture, directory));
        await writeFile(path.join(fixture, directory, "example.tsx"), content);
    }
    const entry = path.join(fixture, "src/app.css");
    await writeFile(entry, await readFile(cssFile, "utf8"));
    const source = await resolveTailwindV4Source({ projectRoot: fixture, cssEntries: [entry] });
    const generator = createWeappTailwindcssGenerator(source);
    t.after(() => generator.dispose?.());
    const output = await generator.generate({
        target: "weapp",
        scanSources: true,
        styleOptions: { rem2rpx: true },
    });
    for (const candidate of ["bg-primary", "text-primary", "p-6", "bg-white", "w-[13px]"])
        assert.ok(output.classSet.has(candidate), candidate);
    for (const candidate of ["bg-orange-950", "text-pink-950", "text-lime-950"])
        assert.equal(output.classSet.has(candidate), false, candidate);
    assert.match(output.css, /--color-primary:\s*#087f5b/u);
    assert.match(output.css, /\.bg-primary\s*\{[^}]*background-color:/u);
    assert.match(output.css, /rpx/u);
    assert.doesNotMatch(output.css, /@(?:layer|theme|source|config|import|property)\b/u);
});

test("Taro 真实转换后，登录与请求按钮保持蓝色背景、白色文字、高度、居中与伪元素边框重置", async (t) => {
    const require = createRequire(import.meta.url);
    const runnerRequire = createRequire(require.resolve("@tarojs/vite-runner"));
    const postcss = runnerRequire("postcss");
    const { getDefaultPostcssConfig } = require("@tarojs/vite-runner/dist/postcss/postcss.mini");
    const { getPostcssPlugins } = require("@tarojs/vite-runner/dist/utils");
    const defaults = require("@tarojs/vite-runner/dist/defaultConfig/defaultConfig.mini").default;
    const plugins = getPostcssPlugins(
        root,
        getDefaultPostcssConfig({
            designWidth: 750,
            postcssOption: structuredClone(defaults.postcss),
        }),
    );
    // 控制样本确保执行了 Taro 的真实标签转换，覆盖旧规则失配的根因。
    const control = await postcss(plugins).process("button::after { border: none; }", {
        from: undefined,
    });
    assert.match(control.css, /\.h5-button::after/u);

    const source = await resolveTailwindV4Source({ projectRoot: root, cssEntries: [cssFile] });
    const generator = createWeappTailwindcssGenerator(source);
    t.after(() => generator.dispose?.());
    const output = await generator.generate({
        target: "weapp",
        scanSources: true,
        styleOptions: { rem2rpx: true },
    });
    const result = await postcss(plugins).process(output.css, { from: cssFile });
    assert.match(result.css, /--color-action:\s*#2563eb/u);
    assert.match(result.css, /\.bg-action\s*\{[^}]*background-color:\s*var\(--color-action\)/u);
    const actionStyles = new Map();
    result.root.walkRules((rule) => {
        if (!rule.selectors.includes(".weapp-action-button")) return;
        rule.walkDecls((declaration) => actionStyles.set(declaration.prop, declaration.value));
    });
    for (const [property, value] of Object.entries({
        height: "96rpx",
        width: "100%",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        padding: "0",
        "box-sizing": "border-box",
    })) {
        assert.equal(actionStyles.get(property), value, `请求按钮样式 ${property}`);
    }
    const resetClasses = new Set();
    result.root.walkRules((rule) => {
        if (!rule.nodes.some((node) => node.prop === "border" && node.value === "none")) return;
        for (const selector of rule.selectors) {
            const match = /^\.([\w-]+)::after$/u.exec(selector);
            if (match) resetClasses.add(match[1]);
        }
    });
    const { createHarness, elements } = require("./harness.cjs");
    const harness = createHarness();
    t.after(() => harness.stop());
    const buttons = elements(harness.render()).filter((item) => item.type === "Button");
    assert.equal(buttons.length, 3);
    for (const button of buttons) {
        const classes = button.props.className.split(/\s+/u);
        assert.ok(classes.includes("bg-action"), "请求按钮使用独立蓝色背景");
        assert.ok(classes.includes("text-white"), "请求按钮保持白色文字");
        assert.ok(
            classes.some((name) => resetClasses.has(name)),
            `按钮 class="${button.props.className}" 需要命中转换后的 ::after 边框重置`,
        );
    }
});
