import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { build } from "vite";
import { createWeappModuleScope } from "../../config/plugins/weapp-module-scope.mjs";

// 微信开发者工具的模块包装会注入这些同名参数。
const parameters = [
    "require",
    "module",
    "exports",
    "window",
    "document",
    "fetch",
    "print",
    "URL",
    "Node",
];
const fixture = `
export const print = (value) => "打印:" + value;
export const Node = class Node {};
export const URL = "测试地址";
export function run() { return print(URL); }
`;

function loadModule(code) {
    const module = { exports: {} };
    const load = vm.runInNewContext(`(function(${parameters.join(",")}) {\n${code}\n})`);
    load(() => {}, module, module.exports);
    return module.exports;
}

test("微信模块包装可复现顶层 print 与注入参数冲突", () => {
    assert.throws(() => loadModule("const print = () => {}; exports.print = print;"), {
        name: "SyntaxError",
        message: /Identifier 'print' has already been declared/u,
    });
});

for (const minify of [false, "esbuild"]) {
    test(`真实 Vite 构建保持微信模块作用域隔离与 CommonJS 导出，minify=${minify}`, async (t) => {
        const root = await mkdtemp(path.join(tmpdir(), "weapp-module-scope-"));
        t.after(() => rm(root, { recursive: true, force: true }));
        const entry = path.join(root, "entry.js");
        await writeFile(entry, fixture);
        const result = await build({
            configFile: false,
            root,
            logLevel: "silent",
            plugins: [createWeappModuleScope()],
            build: {
                write: false,
                minify,
                sourcemap: true,
                lib: { entry, formats: ["cjs"] },
            },
        });
        const chunk = result[0].output.find((output) => output.type === "chunk");
        const exports = loadModule(chunk.code);
        assert.equal(exports.run(), "打印:测试地址");
        assert.equal(exports.print("成功"), "打印:成功");
        assert.equal(typeof exports.Node, "function");
        assert.ok(chunk.map?.sources.some((source) => source.endsWith("entry.js")));
        assert.ok(chunk.map?.mappings);
    });
}

test("Taro 配置注册模块作用域插件", async () => {
    const config = await readFile(new URL("../../config/index.ts", import.meta.url), "utf8");
    assert.match(config, /createWeappModuleScope\(\)/u);
});
