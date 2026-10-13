const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 加载真实 TS/TSX 和 Apollo 运行时，只隔离微信平台与页面 Hooks。
function createHarness({ endpoint = "https://test.invalid/api/graphql/member", token = "" } = {}) {
    const state = { requests: [], status: 200, mode: "ok", delay: 1, aborted: 0, unloaded: [] };
    state.storage = new Map();
    if (token)
        state.storage.set(
            `go-starter:member-auth:${endpoint.replace(/\/api\/graphql\/member\/?$/u, "")}`,
            token,
        );
    state.authResponses = {
        "sign-in/email": { statusCode: 200, data: { token: "test-session" } },
        "sign-out": { statusCode: 200, data: { success: true } },
    };
    const slots = [];
    let cursor = 0;
    const hooks = {
        useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = initial;
            return [
                slots[index],
                (next) => {
                    slots[index] = next;
                },
            ];
        },
        useRef(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = { current: initial };
            return slots[index];
        },
    };
    const taro = {
        useUnload(callback) {
            state.unloaded.push(callback);
        },
        getStorageSync(key) {
            if (state.storageReadError) throw new Error("storage read failed");
            return state.storage.get(key) ?? "";
        },
        setStorageSync(key, value) {
            if (state.storageWriteError) throw new Error("storage write failed");
            state.storage.set(key, value);
        },
        removeStorageSync(key) {
            state.storage.delete(key);
        },
        request(options) {
            state.requests.push(options);
            // Taro request 同时返回带 abort 的 Promise；模拟平台失败的双通道结算。
            let resolveRequest;
            let rejectRequest;
            const request = new Promise((resolve, reject) => {
                resolveRequest = resolve;
                rejectRequest = reject;
            });
            const success = (response) => {
                options.success?.(response);
                resolveRequest(response);
            };
            const fail = (error) => {
                options.fail?.(error);
                rejectRequest(error);
            };
            const timer = setTimeout(() => {
                if (state.mode === "network" || state.mode === "timeout") {
                    fail({ errMsg: "request:fail " + state.mode });
                    return;
                }
                const authPath = options.url.split("/api/auth/")[1];
                if (authPath) {
                    success(state.authResponses[authPath] ?? { statusCode: 404, data: {} });
                    return;
                }
                const operations = JSON.parse(options.data);
                const rows = (Array.isArray(operations) ? operations : [operations]).map(
                    (operation, index) => {
                        if (state.mode === "graphql" || (state.mode === "partial" && index === 1))
                            return {
                                errors: [
                                    { message: "查询失败", extensions: { code: "BAD_USER_INPUT" } },
                                ],
                            };
                        if (state.mode === "missing") return { data: {} };
                        const id = operation.variables?.where?.id?.eq ?? 1;
                        return {
                            data: {
                                getShop:
                                    state.mode === "empty"
                                        ? null
                                        : {
                                              id: String(id),
                                              name: "测试店铺",
                                              slug: "demo-shop",
                                              status: "active",
                                              createdAt: null,
                                              updatedAt: null,
                                          },
                            },
                        };
                    },
                );
                let data = Array.isArray(operations) ? rows : rows[0];
                if (state.mode === "invalid-count") data = rows.slice(0, 1);
                if (state.mode === "invalid-json") data = "无效 JSON";
                success({
                    statusCode: state.status,
                    data,
                    header: { "Content-Type": "application/json" },
                });
            }, state.delay);
            return Object.assign(request, {
                abort() {
                    clearTimeout(timer);
                    state.aborted++;
                    fail({ errMsg: "request:fail abort" });
                },
            });
        },
    };
    const modules = new Map();
    const context = vm.createContext({
        APP_GRAPHQL_ENDPOINT_BUILD: endpoint,
        defineAppConfig: (config) => config,
        console,
        Error,
        Promise,
        AbortController,
        Headers,
        Date,
    });
    function load(file) {
        if (modules.has(file)) return modules.get(file).exports;
        const module = { exports: {} };
        modules.set(file, module);
        const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
                jsx: ts.JsxEmit.ReactJSX,
                esModuleInterop: true,
            },
            fileName: file,
        });
        const localRequire = (id) => {
            if (id === "@tarojs/taro") return taro;
            if (id === "@tarojs/components")
                return Object.fromEntries(
                    ["View", "Text", "Input", "Button", "Navigator"].map((name) => [name, name]),
                );
            if (id === "react") return hooks;
            if (id.startsWith("."))
                return load(
                    path.resolve(path.dirname(file), id) + (/\.tsx?$/u.test(id) ? "" : ".ts"),
                );
            return require(id);
        };
        vm.runInContext(`(function(require,module,exports){${outputText}\n})`, context, {
            filename: file,
        })(localRequire, module, module.exports);
        return module.exports;
    }
    const source = (name) => load(path.resolve(__dirname, "../../src", name));
    return {
        state,
        source,
        render(name = "pages/dev/batch-test/index.tsx") {
            cursor = 0;
            return source(name).default();
        },
        unload() {
            state.unloaded.forEach((callback) => callback());
        },
        stop() {
            modules
                .get(path.resolve(__dirname, "../../src/graphql/client.ts"))
                ?.exports.client.stop();
        },
    };
}
function elements(tree) {
    if (!tree || typeof tree !== "object") return [];
    const children = tree.props?.children;
    return [
        tree,
        ...(Array.isArray(children) ? children.flat(Infinity) : [children]).flatMap(elements),
    ];
}
function texts(tree) {
    return elements(tree)
        .filter((item) => item.type === "Text")
        .map((item) =>
            Array.isArray(item.props.children) ? item.props.children.join("") : item.props.children,
        )
        .join("\n");
}
module.exports = { createHarness, elements, texts };
