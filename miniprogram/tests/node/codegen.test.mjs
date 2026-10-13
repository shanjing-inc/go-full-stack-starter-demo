import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import config from "../../codegen.mjs";
import { synchronize } from "../../scripts/codegen.mjs";
async function fixture(run) {
    const root = await mkdtemp(join(tmpdir(), "member-codegen-"));
    const output = join(root, "generated.ts");
    const options = { ...config, generates: { [output]: Object.values(config.generates)[0] } };
    try {
        await run({ root, output, options });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
test("Member 操作生成保留可空店铺、标量字段与可选筛选", () =>
    fixture(async ({ output, options }) => {
        await synchronize(options);
        const source = await readFile(output, "utf8");
        assert.match(source, /GetMemberShopQueryVariables/);
        assert.match(source, /createdAt: string \| null/);
        assert.match(source, /id: string \| null/);
        assert.match(source, /eq\?: number \| null \| undefined/);
        assert.doesNotMatch(source, /\bany\b|GetCurrentUser/);
    }));
test("缺失及漂移检查只读，无 Git 目录重复生成稳定", () =>
    fixture(async ({ output, options }) => {
        await assert.rejects(synchronize(options, { check: true }), /pnpm codegen/);
        await assert.rejects(readFile(output), { code: "ENOENT" });
        await writeFile(output, "过期内容");
        await assert.rejects(synchronize(options, { check: true }), /pnpm codegen/);
        assert.equal(await readFile(output, "utf8"), "过期内容");
        await synchronize(options);
        const source = await readFile(output, "utf8");
        const before = await stat(output);
        await synchronize(options, { check: true });
        assert.equal((await stat(output)).mtimeMs, before.mtimeMs);
        await synchronize(options);
        assert.equal(await readFile(output, "utf8"), source);
    }));
test("Member 边界拒绝 Admin 字段和错误变量，校验失败保留产物", () =>
    fixture(async ({ root, output, options }) => {
        const document = join(root, "invalid.graphql");
        for (const source of [
            "query Leak { getCurrentUser { id } }",
            "query Invalid($where: String!) { getShop(where: $where) { id } }",
        ]) {
            await writeFile(document, source);
            await writeFile(output, "保留内容");
            await assert.rejects(synchronize({ ...options, documents: [document] }));
            assert.equal(await readFile(output, "utf8"), "保留内容");
        }
    }));
