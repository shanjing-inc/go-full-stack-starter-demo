import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import configure from "../../vite.config.js";

const config = configure({ mode: "test" });
const javascriptBudget = 1_000_000;

const plugin = config.plugins.find((plugin) => plugin.name === "homepage-dev-url");

test("开发日志展示首页，同时保留后台基路径和服务器地址", () => {
    const urls = {
        local: ["http://127.0.0.1:5173/admin/", "http://[::1]:5174/admin/"],
        network: ["http://192.168.1.2:5174/admin/"],
    };
    const printed = [];
    const server = {
        resolvedUrls: urls,
        printUrls() {
            printed.push(this.resolvedUrls);
        },
    };
    plugin.configureServer(server);
    server.printUrls();
    server.printUrls();
    assert.deepEqual(
        printed,
        Array(2).fill({
            local: ["http://127.0.0.1:5173/", "http://[::1]:5174/"],
            network: ["http://192.168.1.2:5174/"],
        }),
    );
    assert.equal(server.resolvedUrls, urls);
    assert.equal(config.base, "/admin/");
    assert.ok(config.server.proxy["^/$"]);
    assert.equal(config.server.proxy["/test/bus"].target, config.server.proxy["^/$"].target);
});

test("打印失败后恢复服务器原始地址", () => {
    const urls = { local: ["http://127.0.0.1:5173/admin/"], network: [] };
    const server = {
        resolvedUrls: urls,
        printUrls() {
            throw new Error("日志写入失败");
        },
    };
    plugin.configureServer(server);
    assert.throws(() => server.printUrls(), /日志写入失败/);
    assert.equal(server.resolvedUrls, urls);
});

test("启动前沿用 Vite 原有打印行为", () => {
    const server = {
        resolvedUrls: null,
        printUrls() {
            assert.equal(this.resolvedUrls, null);
            throw new Error("服务尚未监听");
        },
    };
    plugin.configureServer(server);
    assert.throws(() => server.printUrls(), /服务尚未监听/);
});

test("前端产物与公开资源清单输出到统一 Web 包", () => {
    assert.equal(config.build.outDir, "../backend/internal/web/dist");
    assert.equal(config.build.emptyOutDir, true);
    assert.equal(config.build.manifest, "manifest.json");
    assert.deepEqual(Object.keys(config.build.rolldownOptions.input).sort(), ["admin", "public"]);
    assert.equal(config.base, "/admin/");
});

function resolveFixture(mode, overrides = {}) {
    const frontend = fileURLToPath(new URL("../../", import.meta.url));
    const directory = mkdtempSync(join(frontend, ".env-test-"));
    try {
        writeFileSync(
            join(directory, "vite.config.js"),
            readFileSync(new URL("../../vite.config.js", import.meta.url)),
        );
        writeFileSync(
            join(directory, ".env"),
            "SPA_PORT=5180\nWEB_ORIGIN=http://127.0.0.1:8087\nVITE_SENTRY_RELEASE=base\nAUTH_SECRET=private\n",
        );
        writeFileSync(
            join(directory, ".env.development"),
            "SPA_PORT=5181\nVITE_SENTRY_RELEASE=development\n",
        );
        writeFileSync(
            join(directory, ".env.development.local"),
            "SPA_PORT=5182\nVITE_SENTRY_RELEASE=local\n",
        );
        writeFileSync(join(directory, ".env.production"), "VITE_SENTRY_RELEASE=production\n");
        const env = { ...process.env };
        for (const key of Object.keys(env)) {
            if (key.startsWith("VITE_") || ["SPA_PORT", "WEB_ORIGIN"].includes(key))
                delete env[key];
        }
        const result = spawnSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                `
            import { resolveConfig } from "vite";
            const config = await resolveConfig({configFile: process.argv[1], mode: process.argv[2]}, "serve");
            console.log(JSON.stringify({port: config.server.port, proxy: config.server.proxy, env: config.env}));
        `,
                join(directory, "vite.config.js"),
                mode,
            ],
            { cwd: frontend, env: { ...env, ...overrides }, encoding: "utf8" },
        );
        assert.equal(result.status, 0, result.stderr);
        return JSON.parse(result.stdout.trim());
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

test("前端环境文件按 mode 加载端口与公开配置，代理信息保持服务端使用", () => {
    const resolved = resolveFixture("development");
    assert.equal(resolved.port, 5182);
    for (const proxy of Object.values(resolved.proxy)) {
        assert.equal(proxy.target, "http://127.0.0.1:8087");
    }
    assert.equal(resolved.env.VITE_SENTRY_RELEASE, "local");
    for (const key of ["AUTH_SECRET", "SPA_PORT", "WEB_ORIGIN"]) {
        assert.equal(key in resolved.env, false);
    }
    assert.equal(resolveFixture("production").env.VITE_SENTRY_RELEASE, "production");
});

test("启动器注入的端口和后端代理地址优先于前端环境文件", () => {
    const resolved = resolveFixture("development", {
        SPA_PORT: "5199",
        WEB_ORIGIN: "http://127.0.0.1:8099",
        VITE_SENTRY_RELEASE: "ci",
    });
    assert.equal(resolved.port, 5199);
    for (const proxy of Object.values(resolved.proxy)) {
        assert.equal(proxy.target, "http://127.0.0.1:8099");
    }
    assert.equal(resolved.env.VITE_SENTRY_RELEASE, "ci");
    assert.equal(resolved.proxy["/api"].ws, true);
});

function configureDashboard(source) {
    const previous = process.env.DASHBOARD_SOURCE;
    process.env.DASHBOARD_SOURCE = source;
    try {
        return configure({ mode: "test" });
    } finally {
        if (previous === undefined) delete process.env.DASHBOARD_SOURCE;
        else process.env.DASHBOARD_SOURCE = previous;
    }
}

test("主仓源码模式直接读取公共 Dashboard 源码，样式扫描沿用同一目录", () => {
    const sourceConfig = configureDashboard("1");
    const directory = fileURLToPath(
        new URL("../../../../../packages/shadcnui-dashboard/src/", import.meta.url),
    );
    for (const [specifier, file] of [
        ["@shanjing/shadcnui-dashboard", "index.ts"],
        ["@shanjing/shadcnui-dashboard/styles.css", "styles.css"],
    ]) {
        const alias = sourceConfig.resolve.alias.find((alias) => alias.find.test(specifier));
        assert.equal(alias.replacement, join(directory, file));
    }
    const styles = sourceConfig.plugins.find((plugin) => plugin.name === "dashboard-source-styles");
    assert.equal(styles.enforce, "pre");
    const file = fileURLToPath(new URL("../../src/styles/global.css", import.meta.url));
    const css = readFileSync(file, "utf8");
    for (const id of [file, `${file}?direct`]) {
        const transformed = styles.transform(css, id);
        assert.ok(transformed.code.includes(`@source "${directory.replaceAll("\\", "/")}";`));
        assert.ok(
            transformed.code.includes(
                '@source "../../node_modules/@shanjing/shadcnui-dashboard/dist";',
            ),
        );
        assert.ok(
            !transformed.code.includes(
                '@source "../../node_modules/@shanjing/shadcnui-dashboard/src";',
            ),
        );
    }
    assert.equal(styles.transform(css, `${file}.other.css`), undefined);
});

test("独立应用模式通过包导出消费 Dashboard，保留发布包样式扫描", () => {
    const packageConfig = configureDashboard("0");
    assert.deepEqual(packageConfig.resolve.alias, []);
    assert.ok(packageConfig.plugins.every((plugin) => plugin.name !== "dashboard-source-styles"));
});

test("自动分包保留入口边界，单文件告警预算为 1 MB", () => {
    assert.equal(config.build.rolldownOptions.output?.codeSplitting, undefined);
    assert.equal(config.build.chunkSizeWarningLimit, javascriptBudget / 1000);
});

const root = fileURLToPath(new URL("../../", import.meta.url));
const configFile = fileURLToPath(new URL("../../vite.config.js", import.meta.url));
const dashboardSource = new URL(
    "../../../../../packages/shadcnui-dashboard/src/index.ts",
    import.meta.url,
);

function dependencies(manifest, key, visiting = new Set(), found = new Set()) {
    assert.ok(manifest[key], `manifest 引用存在：${key}`);
    assert.ok(!visiting.has(key), `静态 chunk 依赖保持无环：${key}`);
    if (found.has(key)) return found;
    visiting.add(key);
    for (const dependency of manifest[key].imports ?? []) {
        dependencies(manifest, dependency, visiting, found);
    }
    visiting.delete(key);
    found.add(key);
    return found;
}

for (const [source, label] of [
    ["1", "源码模式"],
    ["0", "包导出模式"],
]) {
    test(
        `${label}构建保持后台同步加载与公开页依赖隔离`,
        { skip: source === "1" && !existsSync(dashboardSource) },
        async (t) => {
            const previous = process.env.DASHBOARD_SOURCE;
            process.env.DASHBOARD_SOURCE = source;
            let result;
            try {
                result = await build({
                    root,
                    configFile,
                    logLevel: "silent",
                    build: { write: false },
                });
            } finally {
                if (previous === undefined) delete process.env.DASHBOARD_SOURCE;
                else process.env.DASHBOARD_SOURCE = previous;
            }
            const files = new Map(result.output.map((file) => [file.fileName, file]));
            assert.ok(files.has("manifest.json"));
            const manifest = JSON.parse(files.get("manifest.json").source);
            const chunks = result.output.filter((file) => file.type === "chunk");
            const admin = dependencies(manifest, "index.html");
            const publicPage = dependencies(manifest, "src/public.ts");
            const backend = admin;
            const modules = (closure) =>
                [...closure]
                    .flatMap((key) =>
                        Object.keys(files.get(manifest[key].file).modules).map((id) =>
                            id.replaceAll("\\", "/"),
                        ),
                    )
                    .join("\n");
            const bytes = (closure) =>
                [...closure].reduce(
                    (total, key) => total + Buffer.byteLength(files.get(manifest[key].file).code),
                    0,
                );
            const gzipBytes = (closure) =>
                [...closure].reduce(
                    (total, key) => total + gzipSync(files.get(manifest[key].file).code).length,
                    0,
                );
            assert.deepEqual(
                Object.entries(manifest)
                    .filter(([, entry]) => entry.isDynamicEntry)
                    .map(([key]) => key),
                [],
                "后台同步加载全部业务模块",
            );
            assert.match(modules(admin), /src\/app\/dashboard-layout\.tsx/);
            for (const page of ["user-list", "queue", "queue-schedules"]) {
                assert.match(
                    modules(backend),
                    new RegExp(`shadcnui-dashboard/(?:src|dist)/pages/${page}\\.`),
                    `后台静态闭包包含 ${page}`,
                );
            }
            assert.match(modules(backend), /src\/features\/queues\/queue-routes\.tsx/);
            t.diagnostic(
                `登录 ${bytes(admin)} B / gzip ${gzipBytes(admin)} B；后台 ${bytes(backend)} B / gzip ${gzipBytes(backend)} B；后台 JS ${backend.size}`,
            );
            assert.ok(
                bytes(backend) <= javascriptBudget,
                `后台完整 JS 总量预算 1 MB，实际 ${bytes(backend)}`,
            );
            assert.ok(backend.size <= 2, `后台完整 JS 预算 2，实际 ${backend.size}`);
            t.diagnostic(
                chunks
                    .map(
                        (chunk) =>
                            `${chunk.name}: ${Buffer.byteLength(chunk.code)} B, gzip ${gzipSync(chunk.code).length} B`,
                    )
                    .join("; "),
            );
            t.diagnostic(
                `登录初始 JS ${admin.size}，公开页初始 JS ${publicPage.size}，总 JS ${chunks.length}`,
            );

            assert.ok(chunks.length <= 3, `总 JS 预算 3，实际 ${chunks.length}`);
            assert.ok(admin.size <= 2, `登录初始 JS 预算 2，实际 ${admin.size}`);
            assert.ok(publicPage.size <= 2, `公开页初始 JS 预算 2，实际 ${publicPage.size}`);
            for (const chunk of chunks) {
                assert.ok(
                    Buffer.byteLength(chunk.code) <= javascriptBudget,
                    `${chunk.fileName} 超过单块 1 MB 预算`,
                );
                for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) {
                    assert.ok(files.has(dependency), `chunk 引用存在：${dependency}`);
                }
            }
            for (const [key, entry] of Object.entries(manifest)) {
                dependencies(manifest, key);
                for (const dynamic of entry.dynamicImports ?? []) {
                    assert.ok(manifest[dynamic], `manifest 异步引用存在：${dynamic}`);
                }
                for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
                    assert.ok(files.has(file), `manifest 资源存在：${file}`);
                }
            }
            assert.doesNotMatch(
                modules(publicPage),
                /node_modules\/(?:react|react-dom|react-router|@apollo|@sentry)\/|src\/app\//,
                "公开页保持后台框架、GraphQL、监控与应用模块隔离",
            );
            const publicBytes = bytes(publicPage);
            assert.ok(publicBytes <= 120_000, `公开页 JS 总量预算 120 kB，实际 ${publicBytes}`);
        },
    );
}
