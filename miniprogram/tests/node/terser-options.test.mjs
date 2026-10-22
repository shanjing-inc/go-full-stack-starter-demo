import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { build } from "vite";
import { createWeappTerserOptions } from "../../config/plugins/weapp-terser-options.mjs";
import { createWeappModuleScope } from "../../config/plugins/weapp-module-scope.mjs";

const require = createRequire(import.meta.url);
const { DEFAULT_TERSER_OPTIONS } = require("@tarojs/vite-runner/dist/utils/constants.js");

for (const explicitFormat of [undefined, { ascii_only: false }]) {
    test(`真实 Vite/Terser 构建兼容 Taro 输出选项，显式 format=${Boolean(explicitFormat)}`, async (t) => {
        const fixture = await mkdtemp(path.join(tmpdir(), "weapp-terser-"));
        t.after(() => rm(fixture, { recursive: true, force: true }));
        const entry = path.join(fixture, "entry.js");
        await writeFile(entry, 'export const message = "中文输出"; // 不应保留的注释\n');
        const result = await build({
            configFile: false,
            root: fileURLToPath(new URL("../../", import.meta.url)),
            logLevel: "silent",
            plugins: [createWeappTerserOptions(), createWeappModuleScope()],
            build: {
                write: false,
                minify: "terser",
                sourcemap: true,
                terserOptions: {
                    ...structuredClone(DEFAULT_TERSER_OPTIONS),
                    format: explicitFormat,
                },
                lib: { entry, formats: ["cjs"] },
            },
        });
        const chunk = result[0].output.find((output) => output.type === "chunk");
        const module = { exports: {} };
        vm.runInNewContext(chunk.code, { exports: module.exports });
        assert.equal(module.exports.message, "中文输出");
        assert.doesNotMatch(chunk.code, /不应保留的注释/u);
        if (explicitFormat) assert.match(chunk.code, /中文输出/u);
        else assert.doesNotMatch(chunk.code, /中文输出/u);
        assert.ok(chunk.map?.mappings);
    });
}
