import { defineConfig } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 优先使用显式路径，其次兼容本机已安装的 headless shell。
function executable() {
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
    const cache = join(homedir(), ".cache/ms-playwright");
    if (existsSync(cache)) {
        for (const name of readdirSync(cache)
            .filter((n) => n.startsWith("chromium_headless_shell-"))
            .sort((a, b) => Number(b.split("-").at(-1)) - Number(a.split("-").at(-1)))) {
            const path = join(cache, name, "chrome-headless-shell-linux64/chrome-headless-shell");
            if (existsSync(path)) return path;
        }
    }
}
export default defineConfig({
    testDir: "./tests",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [
        ["list"],
        ["json", { outputFile: process.env.BROWSER_REPORT || "test-results/browser.json" }],
    ],
    use: {
        baseURL: process.env.TEST_ORIGIN || "http://127.0.0.1:8080",
        headless: true,
        launchOptions: { executablePath: executable() },
        trace: "retain-on-failure",
    },
});
