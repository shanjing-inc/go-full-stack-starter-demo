import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "vite";
import { WeappTailwindcss } from "weapp-tailwindcss/vite";
import { createWeappTailwindWatch } from "../../config/plugins/weapp-tailwind-watch.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("连续脚本增量重建保留卡片间距及新增工具类", async (t) => {
    const fixture = await mkdtemp(path.join(tmpdir(), "tailwind-watch-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    await mkdir(path.join(fixture, "src"));
    await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
    await writeFile(path.join(fixture, "package.json"), "{}");
    const cssEntry = path.join(fixture, "src/app.css");
    const scriptEntry = path.join(fixture, "src/app.js");
    await writeFile(cssEntry, await readFile(path.join(root, "src/app.css"), "utf8"));
    const source = (revision) =>
        `import './app.css'; export const revision = ${revision};
export const className = 'mt-4 flex flex-col gap-3 mt-${revision + 4}';`;
    await writeFile(scriptEntry, source(0));
    const watcher = await build({
        configFile: false,
        root: fixture,
        logLevel: "silent",
        plugins: [
            createWeappTailwindWatch(fixture),
            ...(WeappTailwindcss({
                appType: "taro",
                tailwindcssBasedir: fixture,
                cssEntries: [cssEntry],
                mainCssChunkMatcher: (file) => path.basename(file) === "app.wxss",
                cssOptions: { rem2rpx: true },
            }) ?? []),
        ],
        build: {
            watch: { buildDelay: 20 },
            minify: false,
            rollupOptions: {
                input: scriptEntry,
                preserveEntrySignatures: "strict",
                output: { entryFileNames: "app.js", assetFileNames: "app.wxss" },
            },
        },
    });
    t.after(() => watcher.close());
    const nextBuild = () =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("等待样式 watch 超时")), 30000);
            const listener = (event) => {
                if (event.code !== "END" && event.code !== "ERROR") return;
                clearTimeout(timer);
                watcher.off("event", listener);
                if (event.code === "ERROR") reject(event.error);
                else resolve();
            };
            watcher.on("event", listener);
        });
    await nextBuild();
    for (let revision = 0; revision <= 2; revision++) {
        if (revision > 0) {
            const completed = nextBuild();
            await writeFile(scriptEntry, source(revision));
            await completed;
        }
        const css = await readFile(path.join(fixture, "dist/app.wxss"), "utf8");
        assert.match(css, /\.mt-4\s*\{[^}]*margin-top:/u);
        assert.match(css, /\.gap-3\s*\{[^}]*gap:/u);
        assert.match(css, /--spacing:\s*8rpx/u);
        assert.match(css, new RegExp(`\\.mt-${revision + 4}\\s*\\{`));
    }
});
