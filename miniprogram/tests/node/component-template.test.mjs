import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(path.join(root, "config/index.ts"));

test("Taro 模板配置覆盖页面与组合组件实际使用的微信原生组件", async () => {
    const source = await readFile(path.join(root, "config/index.ts"), "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText;
    const module = { exports: {} };
    const load = vm.runInNewContext(
        `(function(require, module, exports, __dirname, process) {${code}\n})`,
    );
    load(
        (name) => {
            if (name === "@tarojs/cli") return { defineConfig: (factory) => factory() };
            if (name === "weapp-tailwindcss/vite") return { WeappTailwindcss: () => [] };
            if (name === "./plugins/sync-dist-to-windows.mjs")
                return { createWindowsDistSync: () => undefined };
            return require(name);
        },
        module,
        module.exports,
        path.join(root, "config"),
        { env: {} },
    );
    const config = module.exports.default;
    const components = { includes: new Set(["view", "text"]), thirdPartyComponents: new Map() };
    // Taro CLI 会覆盖根配置的同名回调，组件 hook 必须通过 plugins 注册。
    assert.ok(config.plugins?.length, "需要注册 Taro 组件模板插件");
    const callbacks = [];
    for (const entry of config.plugins) {
        assert.ok(path.isAbsolute(entry), "Taro 本地插件使用绝对路径");
        const plugin = require(entry);
        (plugin.default ?? plugin)({
            modifyComponentConfig: (callback) => callbacks.push(callback),
            modifyViteConfig: () => {},
        });
    }
    for (const callback of callbacks) callback({ componentConfig: components });
    async function inspect(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await inspect(file);
                continue;
            }
            if (!file.endsWith(".tsx")) continue;
            const source = ts.createSourceFile(
                file,
                await readFile(file, "utf8"),
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX,
            );
            for (const statement of source.statements) {
                if (
                    !ts.isImportDeclaration(statement) ||
                    statement.moduleSpecifier.text !== "@tarojs/components"
                )
                    continue;
                for (const node of statement.importClause.namedBindings.elements) {
                    if (node.isTypeOnly || statement.importClause.isTypeOnly) continue;
                    const name = (node.propertyName ?? node.name).text.toLowerCase();
                    assert.ok(
                        components.includes.has(name),
                        `原生组件 ${name} 需要对应 WXML 模板：${file}`,
                    );
                }
            }
        }
    }
    await inspect(path.join(root, "src"));
});

test("完整与增量模板生成均保留按钮、输入框、标签和导航", () => {
    const register = require(path.join(root, "config/plugins/weapp-components.cjs"));
    const callbacks = [];
    register({ modifyComponentConfig: (callback) => callbacks.push(callback) });
    assert.equal(callbacks.length, 1);
    const components = {
        includes: new Set(["view", "text"]),
        exclude: new Set(),
        thirdPartyComponents: new Map(),
        includeAll: false,
    };
    callbacks[0]({ componentConfig: components });
    const { UnRecursiveTemplate } = require("@tarojs/shared/dist/template");
    const template = new UnRecursiveTemplate();
    for (let round = 0; round < 2; round++) {
        const wxml = template.buildTemplate(components);
        assert.match(wxml, /<button\s/u);
        assert.match(wxml, /<input\s/u);
        assert.match(wxml, /<label\s/u);
        assert.match(wxml, /<navigator\s/u);
    }
});
