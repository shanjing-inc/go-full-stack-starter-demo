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
        signInWithEmail: {
            statusCode: 200,
            data: { data: { signInWithEmail: { token: "test-session" } } },
        },
        signOut: { statusCode: 200, data: { data: { signOut: true } } },
    };
    const componentSlots = new Map();
    const effectCleanups = new Set();
    const shown = new Map();
    const themeListeners = new Set();
    const contextValues = new Map();
    state.systemTheme = "light";
    let componentPath = "root";
    let slots = [];
    let cursor = 0;
    let effects = [];
    const hooks = {
        createContext: require("react").createContext,
        useContext(context) {
            return contextValues.has(context) ? contextValues.get(context) : context._currentValue;
        },
        useMemo(factory, dependencies) {
            const index = cursor++;
            const previous = slots[index];
            if (
                !previous ||
                !dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))
            ) {
                slots[index] = { value: factory(), dependencies };
            }
            return slots[index].value;
        },
        useCallback(callback, dependencies) {
            const index = cursor++;
            const previous = slots[index];
            if (
                !previous ||
                !dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))
            )
                slots[index] = { callback, dependencies };
            return slots[index].callback;
        },
        useState(initial) {
            const localSlots = slots;
            const index = cursor++;
            if (!(index in localSlots))
                localSlots[index] = typeof initial === "function" ? initial() : initial;
            return [
                localSlots[index],
                (next) => {
                    localSlots[index] = typeof next === "function" ? next(localSlots[index]) : next;
                },
            ];
        },
        useRef(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = { current: initial };
            return slots[index];
        },
        useEffect(callback, dependencies) {
            const localSlots = slots;
            const index = cursor++;
            const previous = localSlots[index];
            if (
                previous &&
                dependencies?.every((value, i) => Object.is(value, previous.dependencies?.[i]))
            )
                return;
            effects.push(() => {
                previous?.cleanup?.();
                if (previous?.cleanup) effectCleanups.delete(previous.cleanup);
                const cleanup = callback();
                if (cleanup) effectCleanups.add(cleanup);
                localSlots[index] = { dependencies, cleanup };
            });
        },
        useSyncExternalStore(subscribe, getSnapshot) {
            const index = cursor++;
            if (!(index in slots)) {
                const cleanup = subscribe(() => {});
                slots[index] = { cleanup };
                effectCleanups.add(cleanup);
            }
            return getSnapshot();
        },
    };
    const taro = {
        getAppBaseInfo: () => ({ theme: state.systemTheme }),
        onThemeChange: (callback) => themeListeners.add(callback),
        offThemeChange: (callback) => themeListeners.delete(callback),
        useUnload(callback) {
            state.unloaded.push(callback);
        },
        useDidShow(callback) {
            shown.set(componentPath, callback);
        },
        async setNavigationBarColor(options) {
            (state.navigation ??= []).push(options);
        },
        async setBackgroundColor(options) {
            (state.backgrounds ??= []).push(options);
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
                const operations = JSON.parse(options.data);
                const authOperation =
                    !Array.isArray(operations) &&
                    /\b(signInWithEmail|signOut)\b/u.exec(operations.query)?.[1];
                if (authOperation) {
                    success(state.authResponses[authOperation] ?? { statusCode: 404, data: {} });
                    return;
                }
                const rows = (Array.isArray(operations) ? operations : [operations]).map(
                    (operation, index) => {
                        if (
                            state.mode === "unauthorized" ||
                            state.mode === "graphql" ||
                            (state.mode === "partial" && index === 1)
                        )
                            return {
                                errors: [
                                    {
                                        message: "查询失败",
                                        extensions: {
                                            code:
                                                state.mode === "unauthorized"
                                                    ? "UNAUTHORIZED"
                                                    : "BAD_USER_INPUT",
                                        },
                                    },
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
        definePageConfig: (config) => config,
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
                    ["View", "Text", "Input", "Button", "Navigator", "Label", "Slot"].map(
                        (name) => [name, name],
                    ),
                );
            if (id === "react") return hooks;
            if (id.startsWith(".")) {
                const target = path.resolve(path.dirname(file), id);
                const resolved = [
                    target,
                    `${target}.ts`,
                    `${target}.tsx`,
                    path.join(target, "index.ts"),
                ].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
                if (!resolved) throw new Error(`无法解析 ${id}，来源 ${file}`);
                return load(resolved);
            }
            return require(id);
        };
        vm.runInContext(`(function(require,module,exports){${outputText}\n})`, context, {
            filename: file,
        })(localRequire, module, module.exports);
        return module.exports;
    }
    const source = (name) => load(path.resolve(__dirname, "../../src", name));
    function renderTree(tree, location) {
        if (Array.isArray(tree))
            return tree.map((child, index) =>
                renderTree(child, `${location}/${child?.key ?? index}`),
            );
        if (!tree || typeof tree !== "object" || !tree.props) return tree;
        if (tree.type?.$$typeof === Symbol.for("react.provider")) {
            const context = tree.type._context;
            const hadValue = contextValues.has(context);
            const previous = contextValues.get(context);
            contextValues.set(context, tree.props.value);
            try {
                return renderTree(tree.props.children, `${location}/provider`);
            } finally {
                if (hadValue) contextValues.set(context, previous);
                else contextValues.delete(context);
            }
        }
        if (typeof tree.type === "function") {
            componentPath = `${location}/${tree.type.name}`;
            if (!componentSlots.has(componentPath)) componentSlots.set(componentPath, []);
            slots = componentSlots.get(componentPath);
            cursor = 0;
            return renderTree(tree.type(tree.props), componentPath);
        }
        return {
            ...tree,
            props: {
                ...tree.props,
                children: renderTree(tree.props.children, `${location}/children`),
            },
        };
    }
    function renderComponent(Component, props = {}, location = "component") {
        effects = [];
        const tree = renderTree({ type: Component, props }, location);
        const pending = effects;
        effects = [];
        pending.forEach((effect) => effect());
        return tree;
    }
    return {
        state,
        source,
        render(name = "pages/dev/batch-test/index.tsx") {
            return renderComponent(source(name).default, {}, name);
        },
        renderComponent,
        changeTheme(theme) {
            state.systemTheme = theme;
            themeListeners.forEach((callback) => callback({ theme }));
        },
        themeListenerCount: () => themeListeners.size,
        show() {
            shown.forEach((callback) => callback());
        },
        unload() {
            state.unloaded.forEach((callback) => callback());
        },
        stop() {
            effectCleanups.forEach((cleanup) => cleanup());
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
    if (tree === null || tree === undefined || typeof tree === "boolean") return "";
    if (typeof tree === "string" || typeof tree === "number") return String(tree);
    if (Array.isArray(tree)) return tree.map(texts).join("");
    // 原生 Typography 的 content 优先于默认插槽。
    if (["t-title", "t-text", "t-paragraph"].includes(tree.type) && tree.props.content) {
        return tree.props.content;
    }
    return texts(tree.props?.children);
}
module.exports = { createHarness, elements, texts };
