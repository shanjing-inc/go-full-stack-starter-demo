import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import config from "../../codegen.mjs";
import { synchronize } from "../../scripts/codegen.mjs";

async function fixture(run) {
    const root = await mkdtemp(join(tmpdir(), "demo-codegen-"));
    const output = join(root, "operations.ts");
    const options = { ...config, generates: { [output]: Object.values(config.generates)[0] } };
    try {
        await run({ root, output, options });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

test("Admin 操作生成保留空值、可选输入和 scalar 映射", () =>
    fixture(async ({ output, options }) => {
        await synchronize(options);
        const source = await readFile(output, "utf8");
        assert.match(source, /export type ListAdminShopsQueryVariables/);
        assert.match(source, /export type GetDashboardSessionQuery/);
        assert.match(source, /export type DashboardQueueRecordQuery/);
        assert.match(source, /where\?: ShopFilters \| null \| undefined/);
        assert.match(source, /createdAt: string \| null/);
        assert.match(source, /data: unknown/);
        assert.match(source, /id: string \| null/);
        assert.doesNotMatch(source, /\bany\b/);
    }));

test("同步检查支持无 Git 目录和未提交产物，重复生成保持字节一致", () =>
    fixture(async ({ output, options }) => {
        await synchronize(options);
        const before = await readFile(output, "utf8");
        const metadata = await stat(output);
        await synchronize(options, { check: true });
        assert.equal((await stat(output)).mtimeMs, metadata.mtimeMs);
        await synchronize(options);
        assert.equal(await readFile(output, "utf8"), before);
    }));

test("过期和缺失产物检查只读，并提示生成命令", () =>
    fixture(async ({ output, options }) => {
        await assert.rejects(synchronize(options, { check: true }), /pnpm codegen/);
        await assert.rejects(readFile(output), { code: "ENOENT" });
        await writeFile(output, "过期产物\n");
        await assert.rejects(synchronize(options, { check: true }), /pnpm codegen/);
        assert.equal(await readFile(output, "utf8"), "过期产物\n");
    }));

test("SDL 与操作字段或变量不匹配时生成失败，保持已有产物", () =>
    fixture(async ({ root, output, options }) => {
        const document = join(root, "invalid.graphql");
        for (const source of [
            "query InvalidField { getCurrentUser { missingField } }",
            "query InvalidVariable($where: String) { listShops(where: $where) { id } }",
        ]) {
            await writeFile(document, source);
            await writeFile(output, "已有产物\n");
            await assert.rejects(synchronize({ ...options, documents: [document] }));
            assert.equal(await readFile(output, "utf8"), "已有产物\n");
        }
    }));

test("未知 scalar 需要显式映射", () =>
    fixture(async ({ root, options }) => {
        const schema = join(root, "unknown.graphql");
        const document = join(root, "unknown-query.graphql");
        await writeFile(schema, "scalar Unmapped\ntype Query { value: Unmapped }");
        await writeFile(document, "query UnknownScalar { value }");
        await assert.rejects(
            synchronize({ ...options, schema, documents: [document] }),
            /Unmapped/,
        );
    }));
