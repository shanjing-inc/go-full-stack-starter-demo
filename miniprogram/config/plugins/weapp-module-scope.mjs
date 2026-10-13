/**
 * 微信模块包装注入 print、URL、Node 等参数，构建产物使用独立作用域避免顶层声明冲突。
 * banner/footer 包裹整个 CommonJS chunk，保留 require/exports 和 Rollup sourcemap。
 * @returns {import("vite").Plugin}
 */
export function createWeappModuleScope() {
    return {
        name: "weapp-module-scope",
        apply: "build",
        config() {
            return {
                build: {
                    rollupOptions: {
                        output: {
                            banner: "(function () {",
                            footer: "})();",
                        },
                    },
                },
            };
        },
    };
}
