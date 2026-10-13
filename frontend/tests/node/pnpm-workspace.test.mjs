import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

for (const [name, relative] of [
    ["主仓", "../../../../../pnpm-workspace.yaml"],
    ["独立应用", "../../../pnpm-workspace.yaml"],
]) {
    test(
        `${name}运行脚本保持依赖目录只读，依赖过期时提示显式安装`,
        { skip: !existsSync(new URL(relative, import.meta.url)) },
        () => {
            const workspace = readFileSync(new URL(relative, import.meta.url), "utf8");
            assert.match(workspace, /^verifyDepsBeforeRun: warn$/mu);
            const directory = mkdtempSync(join(tmpdir(), "dashboard-pnpm-run-"));
            try {
                writeFileSync(
                    join(directory, "pnpm-workspace.yaml"),
                    "packages: []\nverifyDepsBeforeRun: warn\n",
                );
                writeFileSync(
                    join(directory, "package.json"),
                    JSON.stringify({
                        name: "dependency-read-only-fixture",
                        private: true,
                        dependencies: { "fixture-dependency-needs-install": "1.0.0" },
                        scripts: { probe: "node probe.cjs" },
                    }),
                );
                writeFileSync(join(directory, "probe.cjs"), 'console.log("probe-completed");');
                const result = spawnSync("pnpm", ["run", "probe"], {
                    cwd: directory,
                    encoding: "utf8",
                    timeout: 30000,
                    env: { ...process.env, CI: "true" },
                });
                assert.equal(result.status, 0, result.stderr);
                assert.match(result.stdout, /probe-completed/u);
                assert.equal(existsSync(join(directory, "node_modules")), false);
                assert.equal(existsSync(join(directory, "pnpm-lock.yaml")), false);
            } finally {
                rmSync(directory, { recursive: true, force: true });
            }
        },
    );
}
