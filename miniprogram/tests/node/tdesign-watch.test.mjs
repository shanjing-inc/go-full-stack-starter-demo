import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { build } from "vite";
import registerTDesign, {
    createTDesignCompatibility,
    prepareTDesign,
} from "../../config/plugins/tdesign.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const { TaroCompilerContext } = require(
    path.join(
        path.dirname(require.resolve("@tarojs/vite-runner/package.json")),
        "dist/utils/compiler/mini.js",
    ),
);

function nativeCompiler(fixture) {
    const sourceDir = path.join(fixture, "src");
    const nativeComponents = new Map();
    const collect = (entry) => {
        if (nativeComponents.has(entry + ".js")) return;
        const config = JSON.parse(readFileSync(entry + ".json", "utf8"));
        nativeComponents.set(entry + ".js", {
            name: path.relative(sourceDir, entry).split(path.sep).join("/"),
            scriptPath: entry + ".js",
            configPath: entry + ".json",
            templatePath: entry + ".wxml",
            cssPath: entry + ".wxss",
            config,
        });
        for (const relative of Object.values(config.usingComponents ?? {})) {
            collect(path.resolve(path.dirname(entry), relative));
        }
    };
    for (const name of ["button", "input", "title", "text", "paragraph"]) {
        collect(path.join(sourceDir, "native/tdesign", name, name));
    }
    return Object.assign(Object.create(TaroCompilerContext.prototype), {
        sourceDir,
        nativeComponents,
        fileType: { script: ".js", templ: ".wxml", style: ".wxss", config: ".json" },
        taroConfig: {
            template: new (require("@tarojs/shared/dist/template").UnRecursiveTemplate)(),
        },
    });
}

function loadButton(output) {
    for (const name of ["title", "text", "paragraph"]) {
        const css = readFileSync(path.join(output, `native/tdesign/${name}/${name}.wxss`), "utf8");
        assert.match(css, /\.t-typography/);
        assert.match(css, /\.t-typography--secondary/);
    }
    const definitions = [];
    const context = vm.createContext({
        wx: {
            getAppBaseInfo: () => ({ SDKVersion: "3.11.0" }),
            getWindowInfo: () => ({ windowWidth: 375, windowHeight: 800 }),
            getDeviceInfo: () => ({ platform: "devtools" }),
        },
        getApp: () => ({}),
        Behavior: (definition) => definition,
        Component: (definition) => definitions.push(definition),
    });
    const cache = new Map();
    const load = (file) => {
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} };
        cache.set(file, module);
        const code = readFileSync(file, "utf8");
        const execute = vm.runInContext(
            `(function(require,module,exports,print,URL,Node) {\n${code}\n})`,
            context,
            { filename: file },
        );
        execute((id) => load(path.resolve(path.dirname(file), id)), module, module.exports);
        return module.exports;
    };
    load(path.join(output, "native/tdesign/button/button.js"));
    assert.equal(definitions.length, 1, "每轮重建都能实际注册官方 Button");
    assert.ok(definitions[0].properties.theme);
}

test("原生组件首次及连续 Vite watch 重建无覆盖警告且仍可加载注册", async (t) => {
    const fixture = await mkdtemp(path.join(tmpdir(), "tdesign-watch-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    await writeFile(path.join(fixture, "package.json"), "{}");
    await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
    prepareTDesign(fixture);
    const entry = path.join(fixture, "app.js");
    const output = path.join(fixture, "dist");
    const source = (revision) => `
import config from ${JSON.stringify(path.join(fixture, "src/native/tdesign/common/config.js"))};
export const prefix = config.prefix;
export const revision = ${revision};`;
    await writeFile(entry, source(0));
    const compiler = nativeCompiler(fixture);
    const plugins = [createTDesignCompatibility(fixture)];
    registerTDesign({
        modifyComponentConfig() {},
        modifyViteConfig: (configure) =>
            configure({ viteConfig: { plugins }, viteCompilerContext: compiler }),
    });
    const warnings = [];
    let initial = true;
    const watcher = await build({
        configFile: false,
        root: fixture,
        logLevel: "silent",
        plugins: [
            ...plugins,
            {
                name: "taro-native-watch-fixture",
                // 使用真实 Taro 生成器；入口被缓存后，后续轮次不会再次调用。
                buildStart() {
                    if (!initial) return;
                    initial = false;
                    for (const component of compiler.nativeComponents.values()) {
                        compiler.generateNativeComponent(this, component, [entry]);
                    }
                },
                generateBundle() {
                    this.emitFile({ type: "asset", fileName: "app.wxss", source: "" });
                },
            },
        ],
        build: {
            outDir: output,
            emptyOutDir: true,
            minify: false,
            watch: { buildDelay: 20 },
            rollupOptions: {
                input: entry,
                onwarn: (warning) => warnings.push(warning),
                preserveEntrySignatures: "strict",
                output: {
                    format: "cjs",
                    entryFileNames: "[name].js",
                    chunkFileNames: "[name].js",
                    manualChunks: (id) =>
                        id.includes("/native/tdesign/common/") ? "common" : undefined,
                },
            },
        },
    });
    t.after(() => watcher.close());
    const nextBuild = () =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("等待 watch 构建超时")), 30000);
            const listener = async (event) => {
                if (event.code !== "END" && event.code !== "ERROR") return;
                watcher.off("event", listener);
                clearTimeout(timer);
                if (event.code === "ERROR") reject(event.error);
                else resolve();
            };
            watcher.on("event", listener);
        });
    await nextBuild();
    const verify = async () => {
        loadButton(output);
        assert.deepEqual(
            warnings.filter((warning) => warning.code === "FILE_NAME_CONFLICT"),
            [],
            "首次及增量输出不得覆盖同名资源",
        );
        const official = path.join(
            path.dirname(require.resolve("tdesign-miniprogram/package.json")),
            "miniprogram_dist",
        );
        for (const file of ["common/utils.wxs", "button/button.wxml", "icon/icon.wxml"]) {
            const emitted = await readFile(path.join(output, "native/tdesign", file), "utf8");
            assert.equal(emitted, await readFile(path.join(official, file), "utf8"), file);
        }
    };
    await verify();
    for (let revision = 1; revision <= 2; revision++) {
        const completed = nextBuild();
        await writeFile(entry, source(revision));
        await completed;
        await verify();
        assert.match(
            await readFile(path.join(output, "app.js"), "utf8"),
            new RegExp(`revision = ${revision}`),
        );
    }
});

test("同名 TDesign 公共资源内容不一致时构建失败，不影响其他原生组件输出", async (t) => {
    const fixture = await mkdtemp(path.join(tmpdir(), "tdesign-conflict-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    await writeFile(path.join(fixture, "package.json"), "{}");
    await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
    prepareTDesign(fixture);
    const compiler = nativeCompiler(fixture);
    const plugins = [];
    registerTDesign({
        modifyComponentConfig() {},
        modifyViteConfig: (configure) =>
            configure({ viteConfig: { plugins }, viteCompilerContext: compiler }),
    });
    const output = plugins.find((plugin) => plugin.name === "tdesign-native-output");
    const files = [];
    const context = {
        emitFile: (file) => String(files.push(file)),
        addWatchFile() {},
        error: (message) => {
            throw new Error(message);
        },
    };
    output.buildStart.call(context);
    output.buildEnd.call(context);
    const utils = "native/tdesign/common/utils.wxs";
    assert.equal(files.filter((file) => file.fileName === utils).length, 1);
    await writeFile(path.join(fixture, "src", utils), "module.exports = {};\n");
    const button = compiler.nativeComponents.get(
        path.join(fixture, "src/native/tdesign/button/button.js"),
    );
    button.isGenerated = false;
    compiler.generateNativeComponent(context, button);
    assert.throws(() => output.buildEnd.call(context), /同名资源内容不一致.*common\/utils\.wxs/);

    // 下一轮允许资源正常更新，不复用上一轮的内容或资源引用。
    output.buildStart.call(context);
    output.buildEnd.call(context);
    assert.equal(
        Buffer.from(files.filter((file) => file.fileName === utils).at(-1).source).toString(),
        "module.exports = {};\n",
    );

    // 非 TDesign 组件保持 Taro 的隐式入口与模板输出行为。
    const external = {
        ...button,
        scriptPath: path.join(fixture, "src/native/other.js"),
        isGenerated: false,
    };
    const externalIndex = files.length;
    compiler.generateNativeComponent(context, external, ["app.js"]);
    assert.deepEqual(files[externalIndex].implicitlyLoadedAfterOneOf, ["app.js"]);
});
