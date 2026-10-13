import path from "node:path";
import { defineConfig, type UserConfigExport } from "@tarojs/cli";
import { WeappTailwindcss } from "weapp-tailwindcss/vite";
import { createWeappModuleScope } from "./plugins/weapp-module-scope.mjs";
import { createWindowsDistSync } from "./plugins/sync-dist-to-windows.mjs";

export default defineConfig<"vite">(() => {
    const sync = createWindowsDistSync();
    return {
        projectName: "multi-database-demo-miniprogram",
        date: "2026-10-11",
        designWidth: 750,
        deviceRatio: { 640: 1.17, 750: 1, 375: 2, 828: 0.905 },
        sourceRoot: "src",
        outputRoot: "dist",
        framework: "react",
        defineConstants: {
            APP_GRAPHQL_ENDPOINT_BUILD: JSON.stringify(process.env.TARO_APP_GRAPHQL_ENDPOINT ?? ""),
        },
        compiler: {
            type: "vite",
            vitePlugins: [
                createWeappModuleScope(),
                ...(WeappTailwindcss({
                    tailwindcssBasedir: path.resolve(__dirname, ".."),
                    cssEntries: [path.resolve(__dirname, "../src/app.css")],
                    mainCssChunkMatcher: (file: string) =>
                        ["app.css", "app.wxss", "app-origin.wxss"].includes(path.basename(file)),
                    cssOptions: { rem2rpx: true },
                }) ?? []),
                ...(sync ? [sync] : []),
            ],
        },
        plugins: [path.resolve(__dirname, "plugins/weapp-components.cjs")],
        cache: { enable: false },
        mini: { postcss: { pxtransform: { enable: true }, cssModules: { enable: false } } },
    } satisfies UserConfigExport<"vite">;
});
