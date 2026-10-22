import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { build } from "vite";

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve("@tarojs/cli/package.json"));
const downloadRequire = createRequire(cliRequire.resolve("download-git-repo"));
const download = promisify(cliRequire("download-git-repo"));
const AdmZip = cliRequire("adm-zip");
const execFile = promisify(execFileCallback);

async function fixture(t) {
    const directory = await mkdtemp(path.join(tmpdir(), "dependency-security-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

test("模板下载保留 direct ZIP 与 strip 行为，拒绝向目标目录外写入", async (t) => {
    const root = await fixture(t);
    const archive = new AdmZip();
    archive.addFile("repo/template.txt", Buffer.from("模板内容"));
    archive.addFile("repo/template/package.json", Buffer.from('{"name":"fixture"}'));
    const malicious = new AdmZip();
    malicious.addFile("root/aa/bb/escape.txt", Buffer.from("越界内容"));
    const unsafe = Buffer.from(
        malicious
            .toBuffer()
            .toString("latin1")
            .replaceAll("root/aa/bb/escape.txt", "root/../../escape.txt"),
        "latin1",
    );
    const server = createServer((request, response) => {
        response.setHeader("content-type", "application/zip");
        response.end(request.url === "/unsafe.zip" ? unsafe : archive.toBuffer());
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await download(`direct:${origin}/safe.zip`, path.join(root, "safe"), {});
    assert.equal(await readFile(path.join(root, "safe/template.txt"), "utf8"), "模板内容");
    await download(`github:${origin}:team/project#release`, path.join(root, "github"), {});
    assert.equal(await readFile(path.join(root, "github/template.txt"), "utf8"), "模板内容");
    const fetchTemplate = cliRequire("./dist/create/fetchTemplate.js").default;
    for (const [name, source] of [
        ["url", `${origin}/safe.zip`],
        ["git", `direct:${origin}/safe.zip`],
    ]) {
        const templates = await fetchTemplate(source, path.join(root, name), false);
        assert.deepEqual(
            templates.map((item) => item.value),
            ["template"],
        );
        assert.equal(
            JSON.parse(await readFile(path.join(root, name, "template/package.json"), "utf8")).name,
            "fixture",
        );
    }
    // 安全解压器可以拒绝压缩包，也可以跳过恶意条目。
    await download(`direct:${origin}/unsafe.zip`, path.join(root, "unsafe/child"), {}).catch(
        () => {},
    );
    await assert.rejects(access(path.join(root, "escape.txt")), { code: "ENOENT" });
    await assert.rejects(access(path.join(root, "unsafe/escape.txt")), { code: "ENOENT" });
});

test("Git 模板克隆保留指定分支、移除 .git，恶意 revision 不执行命令", async (t) => {
    const root = await fixture(t);
    const repo = path.join(root, "source repository");
    await mkdir(repo);
    const git = (...args) => execFile("git", args, { cwd: repo });
    await git("init", "--initial-branch=main");
    await writeFile(path.join(repo, "template.txt"), "初始内容");
    await git("add", "template.txt");
    await git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-m",
        "fixture",
    );
    await git("checkout", "-b", "release");
    await writeFile(path.join(repo, "template.txt"), "分支内容");
    await git("add", "template.txt");
    await git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-m",
        "release",
    );
    const destination = path.join(root, "downloaded repository");
    await download(`direct:${repo}#release`, destination, { clone: true });
    assert.equal(await readFile(path.join(destination, "template.txt"), "utf8"), "分支内容");
    await assert.rejects(access(path.join(destination, ".git")), { code: "ENOENT" });
    const marker = path.join(root, "injected");
    await assert.rejects(
        download(`direct:${repo}#main;touch ${marker}`, path.join(root, "attack"), { clone: true }),
    );
    await assert.rejects(access(marker), { code: "ENOENT" });
    await assert.rejects(
        download("direct:--upload-pack=touch#main", path.join(root, "option"), { clone: true }),
        /Invalid repository/,
    );
    await assert.rejects(
        download(`direct:${repo}#--help`, path.join(root, "revision"), { clone: true }),
        /Invalid repository/,
    );
});

test("braces 的真实消费依赖拒绝嵌套攻击，普通展开及转义保持可用", () => {
    const helperRequire = createRequire(require.resolve("@tarojs/helper/package.json"));
    const micromatch = helperRequire("micromatch");
    assert.deepEqual(micromatch.braces("src/{pages,components}/*.{ts,tsx}", { expand: true }), [
        "src/pages/*.ts",
        "src/pages/*.tsx",
        "src/components/*.ts",
        "src/components/*.tsx",
    ]);
    const actualBraces = createRequire(helperRequire.resolve("micromatch"))("braces");
    for (const [open, close] of [
        ["{", "}"],
        ["(", ")"],
    ]) {
        const malicious = open.repeat(4999) + "x" + close.repeat(4999);
        for (const operation of [actualBraces, actualBraces.expand, actualBraces.compile]) {
            assert.throws(() => operation(malicious), {
                name: "SyntaxError",
                message: /maximum nesting depth/,
            });
        }
    }
    assert.deepEqual(actualBraces.expand("\\{literal\\}"), ["{literal}"]);
});

test("Taro emit 等待页面、base、递归组件和 custom-wrapper 的真实异步 XML 压缩", async () => {
    const runnerRequire = createRequire(require.resolve("@tarojs/vite-runner/package.json"));
    const emit = runnerRequire("./dist/mini/emit.js").default;
    const { componentConfig } = runnerRequire("./dist/utils/component.js");
    const previous = new Map(componentConfig.thirdPartyComponents);
    componentConfig.thirdPartyComponents.set("custom-wrapper", {});
    const emitted = [];
    const source = '<view>  <text wx:if="{{visible}}">测试</text>  </view>';
    const context = {
        sourceDir: "/fixture/src",
        cwd: "/fixture",
        app: { name: "app", config: {} },
        pages: [{ name: "pages/index", scriptPath: "/fixture/src/pages/index.tsx", config: {} }],
        nativeComponents: new Map(),
        fileType: { templ: ".wxml" },
        getTemplatePath: (name) => `${name}.wxml`,
        getConfigPath: (name) => `${name}.json`,
        getTargetFilePath: (name, ext) => `${name}${ext}`,
        getScriptPath: (name) => `${name}.js`,
        taroConfig: {
            minifyXML: { collapseWhitespace: true },
            template: {
                isSupportRecursive: false,
                isUseXS: false,
                buildTemplate: () => source,
                buildPageTemplate: () => source,
                buildBaseComponentTemplate: () => source,
                buildCustomComponentTemplate: () => source,
            },
        },
    };
    try {
        await emit(context)[0].generateBundle.call(
            { resolve: async () => null, emitFile: (file) => emitted.push(file) },
            {},
            {},
        );
        const templates = emitted.filter((file) => file.fileName.endsWith(".wxml"));
        assert.equal(templates.length, 4);
        for (const file of templates) {
            assert.equal(file.source, '<view><text wx:if="{{visible}}">测试</text></view>');
        }
    } finally {
        componentConfig.thirdPartyComponents.clear();
        for (const [key, value] of previous) componentConfig.thirdPartyComponents.set(key, value);
    }
});

test("旧的不安全下载依赖已从实际下载器依赖中移除", () => {
    for (const name of ["download", "git-clone"]) {
        assert.throws(() => downloadRequire.resolve(name), { code: "MODULE_NOT_FOUND" });
    }
});

test("Taro 的版本查询保留版本参数与 Promise API", async (t) => {
    const latestVersion = cliRequire("latest-version");
    const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(
            JSON.stringify({
                name: "fixture",
                "dist-tags": { latest: "4.3.0" },
                versions: { "4.3.0": { version: "4.3.0" }, "4.2.1": { version: "4.2.1" } },
            }),
        );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(
        () =>
            new Promise((resolve) => {
                server.close(resolve);
                server.closeAllConnections();
            }),
    );
    const registryUrl = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await latestVersion("fixture", { registryUrl }), "4.3.0");
    assert.equal(await latestVersion("fixture", { registryUrl, version: "~4.2.0" }), "4.2.1");
});

test("升级后的 Taro 静态复制与 Terser 插件兼容真实 Vite 7 生产构建", async (t) => {
    const root = await fixture(t);
    const runnerRequire = createRequire(require.resolve("@tarojs/vite-runner/package.json"));
    const { viteStaticCopy } = runnerRequire("vite-plugin-static-copy");
    const terser = runnerRequire("@rollup/plugin-terser");
    await writeFile(path.join(root, "entry.js"), 'export const message = "构建成功";');
    await writeFile(path.join(root, "static.txt"), "静态内容");
    const result = await build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [
            ...viteStaticCopy({ targets: [{ src: "static.txt", dest: "copied" }] }),
            terser(),
        ],
        build: { minify: false, lib: { entry: path.join(root, "entry.js"), formats: ["cjs"] } },
    });
    assert.equal(await readFile(path.join(root, "dist/copied/static.txt"), "utf8"), "静态内容");
    const chunk = result[0].output.find((item) => item.type === "chunk");
    assert.match(chunk.code, /exports.message/);
    assert.ok(chunk.code.length < 200);
});
