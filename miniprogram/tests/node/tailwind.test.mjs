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
    assert.equal(manifest.devDependencies.tailwindcss, "4.3.3");
    assert.equal(manifest.devDependencies.tailwindcss, frontend.devDependencies.tailwindcss);
    const css = await readFile(cssFile, "utf8");
    assert.match(css, /@import "tailwindcss" source\(none\);/u);
    assert.match(css, /@source "\.\/";/u);
    assert.match(css, /@theme inline\s*\{[^}]*--color-primary: var\(--primary\);/u);
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
    assert.match(output.css, /\.bg-primary\s*\{[^}]*background-color:\s*var\(--primary\)/u);
    assert.match(output.css, /\.bg-primary\s*\{[^}]*background-color:/u);
    assert.match(output.css, /rpx/u);
    assert.doesNotMatch(output.css, /@(?:layer|theme|source|config|import|property)\b/u);
});

test("真实样式生成保留布局与官方系统主题，不再叠加旧控件外观", async (t) => {
    const source = await resolveTailwindV4Source({ projectRoot: root, cssEntries: [cssFile] });
    const generator = createWeappTailwindcssGenerator(source);
    t.after(() => generator.dispose?.());
    const output = await generator.generate({
        target: "weapp",
        scanSources: true,
        styleOptions: { rem2rpx: true },
    });
    const official = await readFile(
        path.join(
            root,
            "node_modules/tdesign-miniprogram/miniprogram_dist/common/style/theme/_index.wxss",
        ),
        "utf8",
    );
    assert.match(official, /prefers-color-scheme:\s*dark/u);
    assert.match(official, /--td-brand-color/u);
    assert.match(output.css, /\.ui-page\s*\{[^}]*background:\s*var\(--background\)/u);
    assert.match(output.css, /\.flex-col\s*\{[^}]*flex-direction:\s*column/u);
    assert.match(output.css, /\.gap-3\s*\{[^}]*gap:/u);
    const inline = output.css.match(/\.ui-typography-text\s*\{[^}]*display:\s*inline\s*;?\s*\}/u);
    const block = output.css.match(/\.block\s*\{[^}]*display:\s*block/u);
    assert.ok(inline, "普通 Text 保持行内布局");
    assert.ok(block && block.index > inline.index, "block 工具类可覆盖 Text 的默认布局");
    assert.match(output.css, /\.mt-2\s*\{[^}]*margin-top:/u);
    assert.match(output.css, /\.mt-3\s*\{[^}]*margin-top:/u);
    assert.doesNotMatch(output.css, /ui-button--default|ui-input-placeholder|ui-tag--success/u);
    const { createHarness, elements } = createRequire(import.meta.url)("./harness.cjs");
    const h = createHarness();
    t.after(() => h.stop());
    const buttons = elements(h.render()).filter((item) => item.type === "t-button");
    assert.equal(buttons.length, 3);
    assert.ok(
        buttons.every(
            (button) => button.props.block && button.props.className.includes("ui-button--full"),
        ),
    );
});
