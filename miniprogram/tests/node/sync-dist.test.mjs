import assert from "node:assert/strict";
import {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    existsSync,
    rmSync,
    symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
