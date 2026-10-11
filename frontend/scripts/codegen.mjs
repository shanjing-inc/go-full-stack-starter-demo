import { generate } from "@graphql-codegen/cli";
import { format } from "prettier";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../codegen.mjs";

export async function synchronize(options = config, { check = false } = {}) {
    // 先完成校验和格式化，再处理产物；检查路径全程只读。
    const outputs = await generate(options, false);
    const formatted = await Promise.all(
        outputs.map(async ({ filename, content }) => ({
            filename,
            content: await format(
                "// 自动生成：运行 pnpm codegen 更新，请通过 SDL 和操作源文件修改。\n" + content,
                {
                    parser: "typescript",
                    tabWidth: 4,
                    useTabs: false,
                    printWidth: 100,
                    proseWrap: "preserve",
                },
            ),
        })),
    );
    for (const { filename, content } of formatted) {
        if (check) {
            let existing;
            try {
                existing = await readFile(filename, "utf8");
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
            if (existing !== content)
                throw new Error(`GraphQL 类型产物过期：${filename}，请运行 pnpm codegen。`);
        } else {
            await mkdir(dirname(filename), { recursive: true });
            await writeFile(filename, content);
        }
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    try {
        if (args.some((arg) => arg !== "--check"))
            throw new Error("用法：node scripts/codegen.mjs [--check]");
        await synchronize(config, { check: args.includes("--check") });
        console.log(
            args.includes("--check") ? "GraphQL 类型同步检查通过。" : "GraphQL 操作类型已生成。",
        );
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
