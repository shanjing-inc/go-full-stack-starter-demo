import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { spawnSync } from "node:child_process";

const frontend = new URL("../../", import.meta.url);
const dashboard = new URL("../../../../../packages/shadcnui-dashboard/", import.meta.url);

async function verifyConfig() {
    const { default: assert } = await import("node:assert/strict");
    const { ESLint } = await import("eslint");
    const eslint = new ESLint();
    const lint = async (source) => {
        const [result] = await eslint.lintText(source, { filePath: "src/lint-fixture.tsx" });
        assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
        return result.messages;
    };

    assert.deepEqual(
        await lint(`
            import { useState } from "react";
            export function Accessible() {
                const [value] = useState("图片说明");
                return <img src="/image.png" alt={value} />;
            }
        `),
        [],
    );

    const messages = await lint(`
            import { useState } from "react";
            export function Inaccessible({ visible }: { visible: boolean }) {
                if (visible) useState(0);
                return <><img src="/image.png" /><label>名称</label></>;
            }
        `);
    for (const rule of [
        "jsx-a11y/alt-text",
        "jsx-a11y/label-has-associated-control",
        "react-hooks/rules-of-hooks",
    ]) {
        assert.ok(
            messages.some((message) => message.ruleId === rule),
            rule,
        );
    }
}

for (const [label, directory] of [
    ["应用", frontend],
    ["公共 Dashboard", dashboard],
]) {
    test(
        `${label}的真实 ESLint 配置保留无障碍与 Hook 检查`,
        {
            skip: directory === dashboard && !existsSync(new URL("eslint.config.mjs", directory)),
        },
        () => {
            // 每包独立进程，与真实 CLI 一致，避免 TS parser 的配置根目录缓存相互影响。
            const result = spawnSync(
                process.execPath,
                ["--input-type=module", "-e", `await (${verifyConfig.toString()})();`],
                {
                    cwd: fileURLToPath(directory),
                    encoding: "utf8",
                    timeout: 30_000,
                },
            );
            assert.equal(result.status, 0, String(result.error ?? result.stderr ?? result.stdout));
        },
    );
}
