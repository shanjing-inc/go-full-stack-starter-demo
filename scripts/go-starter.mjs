#!/usr/bin/env node
// 应用启动入口仅选择工具来源，命令执行与路径契约由共享工具维护。
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

try {
    const app = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
    const root = resolve(app, "../..");
    const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"));
    const mode = process.env.STARTER_TOOL_MODE || "auto";
    if (!["auto", "source", "package"].includes(mode))
        throw new Error("STARTER_TOOL_MODE 需要 auto、source 或 package");
    const local = resolve(root, "packages/go-starter-devtools/bin/go-starter.mjs");
    const belongs =
        resolve(root, "projects/multi-database-demo") === app &&
        existsSync(resolve(root, "package.json")) &&
        readJSON(resolve(root, "package.json")).name === "go-full-stack-starter" &&
        existsSync(resolve(root, "pnpm-workspace.yaml")) &&
        existsSync(resolve(root, "scripts/starter_context.py")) &&
        existsSync(local);
    if (mode === "source" && !belongs)
        throw new Error("source 模式需要主仓中的 demo，请检查应用归属");
    let entry = local;
    if (mode === "package" || !belongs) {
        const require = createRequire(new URL("../package.json", import.meta.url));
        const manifest = require.resolve("@shanjing/go-starter-devtools/package.json");
        const metadata = readJSON(manifest);
        const layout = readJSON(resolve(app, "starter.config.json")).layout;
        if (!metadata.supportedLayouts?.includes(layout)) {
            throw new Error(
                `工具 ${metadata.version} 与布局 ${layout} 不兼容；请先升级 devtools 固定依赖`,
            );
        }
        entry = require.resolve("@shanjing/go-starter-devtools/bin/go-starter.mjs");
        process.env.STARTER_TOOL_MODE = "package";
    } else {
        process.env.STARTER_TOOL_MODE = "source";
    }
    process.env.STARTER_ROOT = app;
    await import(pathToFileURL(entry));
} catch (error) {
    console.error(
        `[go-starter] ${error.code === "MODULE_NOT_FOUND" ? "缺少 devtools 固定依赖，请执行 pnpm install" : error.message}`,
    );
    process.exitCode = 1;
}
