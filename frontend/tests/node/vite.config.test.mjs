import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import configure from "../../vite.config.js";

const config = configure({ mode: "test" });

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
    assert.deepEqual(Object.keys(config.build.rollupOptions.input).sort(), ["admin", "public"]);
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
