import assert from "node:assert/strict";
import {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    existsSync,
    rmSync,
    symlinkSync,
    statSync,
    utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "vite";
import {
    createWindowsDistSync,
    validateDestination,
    syncDist,
} from "../../config/plugins/sync-dist-to-windows.mjs";

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), "weapp-sync-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const source = join(root, "project", "dist");
    mkdirSync(source, { recursive: true });
    return { root, source, destination: join(root, "Windows space", "dist") };
}

test("同步未配置时保持关闭，配置后校验专用 Windows dist 目录", () => {
    assert.equal(createWindowsDistSync({ env: {} }), undefined);
    for (const value of [
        "",
        "dist",
        "/",
        "/mnt/c",
        "/mnt/c/dist",
        "/mnt/c/work/source",
        "/tmp/project/dist",
    ]) {
        assert.throws(() => validateDestination("/home/test/project", value), /同步目标/);
    }
    assert.equal(
        validateDestination("/home/test/project", "/mnt/c/work/demo space/dist"),
        "/mnt/c/work/demo space/dist",
    );
    assert.throws(
        () => validateDestination("/mnt/c/work/demo", "/mnt/c/work/demo/dist"),
        /同步目标/,
    );
});

test("镜像同步保留私有配置，完整及增量同步删除旧文件，支持空格路径", (t) => {
    const { source, destination } = fixture(t);
    writeFileSync(join(source, "app.js"), "第一版");
    syncDist(source, destination);
    assert.equal(readFileSync(join(destination, "app.js"), "utf8"), "第一版");
    writeFileSync(join(destination, "project.private.config.json"), "私有配置");
    writeFileSync(join(source, "project.private.config.json"), "构建侧私有配置");
    writeFileSync(join(destination, "old.js"), "旧文件");
    writeFileSync(join(source, "app.js"), "第二版");
    syncDist(source, destination);
    assert.equal(readFileSync(join(destination, "app.js"), "utf8"), "第二版");
    assert.equal(
        readFileSync(join(destination, "project.private.config.json"), "utf8"),
        "私有配置",
    );
    assert.equal(existsSync(join(destination, "old.js")), false);
});

test("增量同步不触碰内容未变的配置，仍发布页面内容与路由变更", (t) => {
    const { source, destination } = fixture(t);
    const config = JSON.stringify({ pages: ["pages/dev/components/index"] });
    writeFileSync(join(source, "app.json"), config);
    writeFileSync(join(source, "app.js"), "第一版");
    syncDist(source, destination);
    const before = statSync(join(destination, "app.json")).mtimeMs;
    // Taro 每轮重新输出配置；字节不变，源文件时间仍会变化。
    const rebuiltAt = new Date("2030-01-01T00:00:00Z");
    utimesSync(join(source, "app.json"), rebuiltAt, rebuiltAt);
    writeFileSync(join(source, "app.js"), "第二版");
    syncDist(source, destination);
    assert.equal(statSync(join(destination, "app.json")).mtimeMs, before);
    assert.equal(readFileSync(join(destination, "app.js"), "utf8"), "第二版");
    const nextConfig = JSON.stringify({ pages: ["pages/dev/components/index", "pages/new/index"] });
    writeFileSync(join(source, "app.json"), nextConfig);
    syncDist(source, destination);
    assert.equal(readFileSync(join(destination, "app.json"), "utf8"), nextConfig);
});

test("同步钩子等待其他异步产物处理完成后再发布", async (t) => {
    const { root, source, destination } = fixture(t);
    const plugin = createWindowsDistSync({
        root,
        env: { TARO_APP_WINDOWS_DIST: "/mnt/c/weapp-sync-hook-test/dist" },
    });
    await build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [
            {
                name: "async-output-producer",
                generateBundle() {
                    this.emitFile({ type: "asset", fileName: "app.json", source: "初始产物" });
                },
                async writeBundle() {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    writeFileSync(join(source, "app.json"), "最终产物");
                },
            },
            {
                ...plugin,
                // 保留实际钩子的调度属性，只将同步目的地换成临时目录。
                writeBundle: {
                    ...plugin.writeBundle,
                    handler() {
                        syncDist(source, destination);
                    },
                },
            },
        ],
        build: {
            outDir: source,
            emptyOutDir: true,
            rollupOptions: {
                input: "virtual:entry",
                plugins: [
                    {
                        name: "test-entry",
                        resolveId: (id) => (id === "virtual:entry" ? id : undefined),
                        load: (id) =>
                            id === "virtual:entry" ? "export const revision = 1;" : undefined,
                    },
                ],
            },
        },
    });
    assert.equal(readFileSync(join(destination, "app.json"), "utf8"), "最终产物");
});

test("已有外来产物、源目录重叠和符号链接目标受到保护", (t) => {
    const { root, source, destination } = fixture(t);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "foreign.txt"), "保留");
    assert.throws(() => syncDist(source, destination), /专用|归属/);
    assert.equal(readFileSync(join(destination, "foreign.txt"), "utf8"), "保留");
    assert.throws(() => syncDist(source, source), /重叠/);
    const link = join(root, "link");
    symlinkSync(join(root, "project"), link);
    assert.throws(() => syncDist(source, join(link, "dist")), /重叠|符号链接/);
});

test("同步失败向构建传播，缺失源产物保持目标内容", (t) => {
    const { source, destination } = fixture(t);
    assert.throws(
        () =>
            syncDist(source, destination, () => {
                throw new Error("rsync 失败");
            }),
        /同步失败/,
    );
    assert.throws(() => syncDist(join(source, "missing"), destination), /产物/);
});

test("首次部分同步失败保留归属，后续重试恢复；其他源工程受到保护", (t) => {
    const { root, source, destination } = fixture(t);
    writeFileSync(join(source, "app.js"), "完整产物");
    assert.throws(
        () =>
            syncDist(source, destination, () => {
                writeFileSync(join(destination, "partial.js"), "中断产物");
                throw new Error("rsync 中断");
            }),
        /同步失败/,
    );
    syncDist(source, destination);
    assert.equal(readFileSync(join(destination, "app.js"), "utf8"), "完整产物");
    assert.equal(existsSync(join(destination, "partial.js")), false);
    const other = join(root, "other", "dist");
    mkdirSync(other, { recursive: true });
    assert.throws(() => syncDist(other, destination), /归属/);
});
