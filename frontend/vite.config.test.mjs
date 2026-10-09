import assert from "node:assert/strict";
import test from "node:test";
import config from "./vite.config.js";

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
