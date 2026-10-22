/**
 * Taro 4.3 仍使用 Terser 的 output 别名，Vite 7.3 会额外写入 format。
 * 在 Vite 创建压缩插件前合并为 format，保留 Taro 的 ES5／ASCII 输出设置。
 * @returns {import("vite").Plugin}
 */
export function createWeappTerserOptions() {
    return {
        name: "weapp-terser-options",
        apply: "build",
        enforce: "post",
        config(config) {
            const options = config.build?.terserOptions;
            if (!options?.output) return;
            options.format = { ...options.output, ...options.format };
            delete options.output;
        },
    };
}
